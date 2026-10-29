import { dayEndTime } from '@/features/widgets/android/widgets';

jest.mock('react-native-android-widget', () => ({ FlexWidget: () => null, SvgWidget: () => null, TextWidget: () => null }));
jest.mock('@gozali/critter-art', () => ({ renderCritter: () => '' }));

type Pack = Parameters<typeof dayEndTime>[0];
const pack = { dayEndsAt: '2026-10-30T01:00:00Z' } as Pack;

describe('the Android widget', () => {
  afterEach(() => jest.useRealTimers());

  it('says when the day ends, the same whenever it was drawn', () => {
    const shown = new Date('2026-10-30T01:00:00Z').toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    jest.useFakeTimers({ now: new Date('2026-10-29T20:00:00Z') });
    const early = dayEndTime(pack);
    jest.setSystemTime(new Date('2026-10-29T22:30:00Z'));
    expect(dayEndTime(pack)).toBe(early);
    expect(early).toBe(shown);
  });
});
