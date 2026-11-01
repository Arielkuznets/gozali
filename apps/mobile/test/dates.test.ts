import { packDayOf } from '@gozali/game-engine';
import { getCalendars, type Calendar } from 'expo-localization';

import { deviceTimeZone, shiftMonth } from '@/lib/dates';

jest.mock('expo-localization', () => ({ ...jest.requireActual('expo-localization'), getCalendars: jest.fn() }));

const phoneSetTo = (timeZone: string | null) => {
  jest.mocked(getCalendars).mockReturnValue([{ timeZone } as Calendar]);
};

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
