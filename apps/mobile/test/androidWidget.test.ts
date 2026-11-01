import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReactElement, ReactNode } from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { widgetTaskHandler } from '@/features/widgets/android/task';
import { PackWidget, dayEndTime } from '@/features/widgets/android/widgets';
import { noteServerDate } from '@/lib/serverClock';

jest.mock('react-native-android-widget', () => ({ FlexWidget: () => null, SvgWidget: () => null, TextWidget: () => null }));
const mockRenderCritter = jest.fn();
jest.mock('@gozali/critter-art', () => ({
  ...jest.requireActual('@gozali/critter-art'),
  renderCritter: (art: unknown) => mockRenderCritter(art),
}));

type Pack = Parameters<typeof dayEndTime>[0];
const pack = { dayEndsAt: '2026-10-30T01:00:00Z', art: 'awake', nightArt: 'asleep' } as unknown as Pack;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const SNAPSHOT_KEY = 'gozali.widget-snapshot';
const OFFSET_KEY = 'gozali.server-offset';

/** Eight in the evening on the phone, wherever the tests run. */
const PHONE_EVENING = new Date(2026, 9, 29, 20, 0).getTime();

const heardFromServer = (serverNow: number, phoneNow: number) => noteServerDate(new Date(serverNow).toUTCString(), phoneNow, phoneNow);

/** Runs the task as Android does, and draws what it asks for. */
const refresh = (task = widgetTaskHandler) =>
  task({
    widgetInfo: { widgetName: 'PackSmall', widgetId: 1 } as WidgetTaskHandlerProps['widgetInfo'],
    widgetAction: 'WIDGET_UPDATE',
    renderWidget: (widget) => {
      const { type: draw, props } = widget as ReactElement<unknown, (props: unknown) => ReactNode>;
      draw(props);
    },
  });

beforeEach(async () => {
  await AsyncStorage.clear();
  mockRenderCritter.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  heardFromServer(Date.now(), Date.now());
});

describe('the Android widget', () => {
  it('says when the day ends, the same whenever it was drawn', () => {
    const shown = new Date('2026-10-30T01:00:00Z').toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    jest.useFakeTimers({ now: new Date('2026-10-29T20:00:00Z') });
    const early = dayEndTime(pack);
    jest.setSystemTime(new Date('2026-10-29T22:30:00Z'));
    expect(dayEndTime(pack)).toBe(early);
    expect(early).toBe(shown);
  });
});

describe('a widget refresh on Android', () => {
  const fetched = jest.fn();

  /** A snapshot on the phone, with the server's time on it and when the phone got it. */
  const saveSnapshot = (fetchedAt: number, savedAt?: number) =>
    AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ timezone: 'UTC', fetchedAt: new Date(fetchedAt).toISOString(), savedAt, packs: [pack] }));

  beforeEach(async () => {
    jest.useFakeTimers({ now: PHONE_EVENING });
    await AsyncStorage.setItem('gozali.widget-token', 'token');
    fetched.mockReset();
    globalThis.fetch = fetched.mockImplementation(async () => ({
      status: 200,
      ok: true,
      headers: new Headers(),
      json: async () => ({ timezone: 'UTC', fetchedAt: new Date(Date.now()).toISOString(), packs: [pack] }),
    })) as unknown as typeof fetch;
  });

  it('fetches what the phone got half an hour ago, however new the time on it looks', async () => {
    await saveSnapshot(PHONE_EVENING + 3 * HOUR - 30 * MINUTE, PHONE_EVENING - 30 * MINUTE);
    await refresh();
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it('keeps what the phone got minutes ago, however old the time on it looks', async () => {
    await saveSnapshot(PHONE_EVENING - 3 * HOUR - 10 * MINUTE, PHONE_EVENING - 10 * MINUTE);
    await refresh();
    expect(fetched).not.toHaveBeenCalled();
  });

  it('fetches once the clock was set back since the phone got it', async () => {
    await saveSnapshot(PHONE_EVENING, PHONE_EVENING + 10 * MINUTE);
    await refresh();
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("fetches when the phone didn't note when it got the snapshot", async () => {
    await saveSnapshot(PHONE_EVENING);
    await refresh();
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it('notes the time on the phone, so the next refresh needs no fetch', async () => {
    await refresh();
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await AsyncStorage.getItem(SNAPSHOT_KEY))!).savedAt).toBe(PHONE_EVENING);

    jest.setSystemTime(PHONE_EVENING + 24 * MINUTE);
    await refresh();
    expect(fetched).toHaveBeenCalledTimes(1);

    jest.setSystemTime(PHONE_EVENING + 26 * MINUTE);
    await refresh();
    expect(fetched).toHaveBeenCalledTimes(2);
  });
});

describe('the critter on an Android widget', () => {
  it("sleeps at night on the server's clock, like the critter in the app", () => {
    jest.useFakeTimers({ now: PHONE_EVENING });
    heardFromServer(PHONE_EVENING + 3 * HOUR, PHONE_EVENING);
    PackWidget({ pack });
    expect(mockRenderCritter).toHaveBeenCalledWith('asleep');
  });

  it("stays awake on the server's clock, however late the phone says it is", () => {
    jest.useFakeTimers({ now: PHONE_EVENING + 3 * HOUR });
    heardFromServer(PHONE_EVENING, PHONE_EVENING + 3 * HOUR);
    PackWidget({ pack });
    expect(mockRenderCritter).toHaveBeenCalledWith('awake');
  });

  it("uses the last run's offset when Android starts the task without the app", async () => {
    jest.spyOn(Date, 'now').mockReturnValue(PHONE_EVENING);
    await AsyncStorage.setItem(OFFSET_KEY, String(3 * HOUR));
    await AsyncStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({ timezone: 'UTC', fetchedAt: new Date(PHONE_EVENING).toISOString(), savedAt: PHONE_EVENING, packs: [pack] }),
    );
    const read = jest.mocked(AsyncStorage.getItem);
    const instantly = read.getMockImplementation()!;
    let offsetBack = () => {};
    const held = new Promise<void>((resolve) => (offsetBack = resolve));
    read.mockImplementation(async (key) => {
      if (key === OFFSET_KEY) await held;
      return instantly(key);
    });

    let task: typeof widgetTaskHandler | undefined;
    jest.isolateModules(() => {
      task = jest.requireActual<typeof import('@/features/widgets/android/task')>('@/features/widgets/android/task').widgetTaskHandler;
    });
    const drawn = refresh(task);
    await new Promise((resolve) => setTimeout(resolve, 20));
    offsetBack();
    await drawn;
    read.mockImplementation(instantly);

    expect(mockRenderCritter).toHaveBeenCalledWith('asleep');
  });
});
