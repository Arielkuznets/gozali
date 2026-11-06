import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import FocusScreen from '@/app/(app)/pack/[id]/focus';
import type { NotificationPermission } from '@/lib/notifications';

// The real focus screen and timer, over what the phone answers about notifications.
let mockPermission: NotificationPermission | null;
const mockAllow = jest.fn();
jest.mock('@/lib/notifications', () => ({
  allowNotifications: () => mockAllow(),
  useNotificationPermission: () => ({ permission: mockPermission, request: jest.fn() }),
}));
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  scheduleNotificationAsync: async () => 'end-of-focus',
  cancelScheduledNotificationAsync: async () => undefined,
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'p1' }),
  useIsFocused: () => true,
  useNavigation: () => ({ isFocused: () => true, getState: () => ({ routes: [] }) }),
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/features/critter/Critter', () => ({ Critter: () => null }));
jest.mock('@/features/packs/api', () => ({
  usePack: () => ({ data: { name: 'Study group', category: 'study', critters: null }, isPending: false, isError: false, refetch: jest.fn() }),
}));

const OFF = 'Notifications are off, so check back here when time is up.';
const STORAGE_KEY = 'gozali.focus';

let screen: ReactTestRenderer;
const shown = () => JSON.stringify(screen.toJSON());

async function open() {
  await act(async () => {
    screen = create(<FocusScreen />);
  });
}

async function pick(label: string) {
  await act(async () => screen.root.findAll((node) => node.props.label === label && node.props.onPress)[0]?.props.onPress());
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockPermission = 'granted';
  mockAllow.mockReset().mockResolvedValue(true);
});

afterEach(async () => {
  await act(async () => screen.unmount());
});

describe('a focus session with notifications off for the app', () => {
  beforeEach(() => {
    mockPermission = 'blocked';
    mockAllow.mockResolvedValue(false);
  });

  it('says before it starts that the end will go unannounced', async () => {
    await open();

    expect(shown()).toContain('Pick a length');
    expect(shown()).toContain(OFF);
  });

  it('says so while it runs', async () => {
    await open();
    await pick('25 minutes');

    expect(shown()).toContain('25 minute session');
    expect(shown()).toContain(OFF);
  });

  it('has nothing to say about a timer with no end', async () => {
    await open();
    await pick('No time limit');

    expect(shown()).toContain('Open session');
    expect(shown()).not.toContain(OFF);
  });
});

it('says nothing of the kind with notifications on', async () => {
  await open();
  await pick('25 minutes');

  expect(shown()).toContain('25 minute session');
  expect(shown()).not.toContain(OFF);
});

it('starts when asking for notifications fails, as the timer runs without them', async () => {
  mockAllow.mockRejectedValue(new Error('The phone did not answer'));
  await open();
  await pick('25 minutes');

  expect(shown()).toContain('25 minute session');
  expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? 'null')).toMatchObject({ packId: 'p1', minutes: 25 });
});
