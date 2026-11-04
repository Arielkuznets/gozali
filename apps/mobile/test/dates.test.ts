import { packDayOf } from '@gozali/game-engine';
import { getCalendars, type Calendar } from 'expo-localization';

import { deviceTimeZone, formatMoment, readableZone, shiftMonth } from '@/lib/dates';
import { reportError } from '@/lib/reportError';

jest.mock('expo-localization', () => ({ ...jest.requireActual('expo-localization'), getCalendars: jest.fn() }));
jest.mock('@/lib/reportError', () => ({ reportError: jest.fn() }));

const phoneSetTo = (timeZone: string | null) => {
  jest.mocked(getCalendars).mockReturnValue([{ timeZone } as Calendar]);
};

describe('formatMoment', () => {
  const clockOf24Hours = (uses24hourClock: boolean | null) => {
    jest.mocked(getCalendars).mockReturnValue([{ timeZone: 'Asia/Jerusalem', uses24hourClock } as Calendar]);
  };
  // Times on the clock of wherever the tests run, as the feed shows them.
  const evening = new Date(2026, 10, 2, 20, 45).toISOString();
  const pastMidnight = new Date(2026, 10, 2, 0, 5).toISOString();
  const sameDay = new Date(2026, 10, 2, 12).toDateString();

  it('is on a 24-hour clock on a phone set to one, from midnight on', () => {
    clockOf24Hours(true);
    expect(formatMoment(evening, sameDay)).toBe('20:45');
    expect(formatMoment(pastMidnight, sameDay)).toBe('00:05');
  });

  it('is on a 12-hour clock on a phone set to one', () => {
    clockOf24Hours(false);
    expect(formatMoment(evening, sameDay)).toMatch(/^08:45\sPM$/);
    expect(formatMoment(pastMidnight, sameDay)).toMatch(/^12:05\sAM$/);
  });

  it("is on the app language's clock on a phone that doesn't say", () => {
    clockOf24Hours(null);
    expect(formatMoment(evening, sameDay)).toMatch(/^08:45\sPM$/);
  });

  it('comes after the date on another day', () => {
    clockOf24Hours(true);
    expect(formatMoment(evening, new Date(2026, 10, 3, 12).toDateString())).toBe('Nov 2, 20:45');
  });
});

describe('deviceTimeZone', () => {
  it('is the name the phone gives', () => {
    phoneSetTo('Asia/Jerusalem');
    expect(deviceTimeZone()).toBe('Asia/Jerusalem');
  });

  it('is UTC on a phone that names no zone', () => {
    phoneSetTo(null);
    expect(deviceTimeZone()).toBe('UTC');
  });

  it.each([
    ['GMT+02:00', 'Etc/GMT-2'],
    ['+02:00', 'Etc/GMT-2'],
    ['GMT-05:00', 'Etc/GMT+5'],
    ['-05:00', 'Etc/GMT+5'],
    ['GMT+0200', 'Etc/GMT-2'],
    ['GMT+2', 'Etc/GMT-2'],
    ['GMT+14:00', 'Etc/GMT-14'],
    ['GMT-12:00', 'Etc/GMT+12'],
  ])('turns the bare offset %s into %s', (offset, zone) => {
    phoneSetTo(offset);
    expect(deviceTimeZone()).toBe(zone);
  });

  it('keeps the side of UTC the offset is on, so the day turns over at 03:00 on the phone', () => {
    phoneSetTo('GMT+02:00');
    expect(packDayOf(new Date('2026-11-01T00:59:00Z'), deviceTimeZone())).toBe('2026-10-31');
    expect(packDayOf(new Date('2026-11-01T01:00:00Z'), deviceTimeZone())).toBe('2026-11-01');

    phoneSetTo('GMT-05:00');
    expect(packDayOf(new Date('2026-11-01T07:59:00Z'), deviceTimeZone())).toBe('2026-10-31');
    expect(packDayOf(new Date('2026-11-01T08:00:00Z'), deviceTimeZone())).toBe('2026-11-01');
  });

  it.each(['GMT+00:00', 'GMT-00:00', '+00:00', '-00:00'])('reads %s as UTC', (offset) => {
    phoneSetTo(offset);
    expect(deviceTimeZone()).toBe('UTC');
  });

  it.each(['GMT+05:30', '+05:30', 'GMT+05:45', 'GMT-03:30', 'GMT+15:00', 'GMT-13:00', 'GMT+23:00'])(
    'falls back to UTC for %s, which no Etc zone has',
    (offset) => {
      phoneSetTo(offset);
      expect(deviceTimeZone()).toBe('UTC');
    },
  );

  it('falls back to UTC for a name Intl on this phone can not read', () => {
    phoneSetTo('Etc/Unknown');
    expect(deviceTimeZone()).toBe('UTC');
  });
});

describe('readableZone', () => {
  beforeEach(() => {
    jest.mocked(reportError).mockClear();
    phoneSetTo('Asia/Jerusalem');
  });

  it("is the pack's own zone when this phone reads it", () => {
    expect(readableZone('Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(reportError).not.toHaveBeenCalled();
  });

  it("is the phone's zone for a name this phone can not read", () => {
    expect(readableZone('Mars/Olympus')).toBe('Asia/Jerusalem');
  });

  it('gives a zone the rules can read, so a screen can draw the pack day', () => {
    expect(() => packDayOf(new Date(), 'Mars/Hellas')).toThrow(RangeError);
    expect(packDayOf(new Date('2026-11-01T01:00:00Z'), readableZone('Mars/Hellas'))).toBe('2026-11-01');
  });

  it('tells the developer of each such zone once, for it comes up on every draw', () => {
    readableZone('Venus/Maxwell');
    readableZone('Venus/Maxwell');
    readableZone('Venus/Alpha');

    expect(jest.mocked(reportError).mock.calls.map(([error]) => (error as Error).message)).toEqual([
      expect.stringContaining('Venus/Maxwell'),
      expect.stringContaining('Venus/Alpha'),
    ]);
  });
});

describe('shiftMonth', () => {
  it('moves within a year', () => {
    expect(shiftMonth('2026-09', 1)).toBe('2026-10');
    expect(shiftMonth('2026-09', -1)).toBe('2026-08');
  });

  it('crosses the new year both ways', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
  });
});
