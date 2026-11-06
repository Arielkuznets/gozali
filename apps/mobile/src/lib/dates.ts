import { packDayOf } from '@gozali/game-engine';
import { getCalendars } from 'expo-localization';

import i18n from '@/i18n';
import { reportError } from '@/lib/reportError';

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Dates follow the app's language, not the device's, so a screen never mixes the two. */
function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${i18n.language}:${JSON.stringify(options)}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(i18n.language, options);
    formatters.set(key, format);
  }
  return format;
}

/** A pack day (YYYY-MM-DD) for display, like "Fri, Oct 2". Noon avoids time zone edges. */
export function formatDay(day: string): string {
  return formatter({ weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00`));
}

/** As formatDay, with the year for a day of another year than this one, like "Sun, Nov 8, 2026". */
export function formatDayAcrossYears(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  const year = date.getFullYear() === new Date().getFullYear() ? {} : ({ year: 'numeric' } as const);
  return formatter({ weekday: 'short', month: 'short', day: 'numeric', ...year }).format(date);
}

/**
 * The phone's choice of a 12 or 24-hour clock, which is no language, or the language's own where it
 * says nothing. A cycle and not hour12: Hermes takes hour12 false in English for h24, so 00:05 would
 * read 24:05.
 */
function phoneClock(): Pick<Intl.DateTimeFormatOptions, 'hourCycle'> {
  const uses24hourClock = getCalendars()[0]?.uses24hourClock;
  if (uses24hourClock === null || uses24hourClock === undefined) return {};
  return { hourCycle: uses24hourClock ? 'h23' : 'h12' };
}

/** A moment as a time today, or with the date on other days. `today` is a `Date.toDateString`. */
export function formatMoment(at: string, today: string): string {
  const date = new Date(at);
  const time = formatter({ hour: '2-digit', minute: '2-digit', ...phoneClock() }).format(date);
  if (date.toDateString() === today) return time;
  return `${formatter({ month: 'short', day: 'numeric' }).format(date)}, ${time}`;
}

/** A zone given only by its distance from UTC: GMT+02:00 on Android, +02:00 in a browser. */
const BARE_OFFSET = /^(?:GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/;

/**
 * Neither the server nor Intl on an Android phone reads a bare offset, so it goes by the Etc zone
 * at that offset, whose sign runs the other way: UTC+2 is Etc/GMT-2. Those zones are whole hours
 * from UTC-12 to UTC+14, so any other offset is UTC.
 */
function namedZone(zone: string): string {
  const match = BARE_OFFSET.exec(zone);
  if (!match) return zone;
  const [, sign, hours, minutes = '00'] = match;
  const east = sign === '+';
  const whole = Number(hours);
  if (whole === 0 || whole > (east ? 14 : 12) || minutes !== '00') return 'UTC';
  return `Etc/GMT${east ? '-' : '+'}${whole}`;
}

const readable = new Map<string, boolean>();

/** Whether Intl on this phone reads a zone. Screens ask on every draw, so each zone is tried once. */
function isReadable(zone: string): boolean {
  let known = readable.get(zone);
  if (known === undefined) {
    try {
      packDayOf(new Date(), zone);
      known = true;
    } catch {
      known = false;
    }
    readable.set(zone, known);
  }
  return known;
}

/**
 * The phone's time zone, like "Asia/Jerusalem". Me draws the pack day in it, and Me is the way to
 * Settings and Delete account.
 */
export function deviceTimeZone(): string {
  const zone = namedZone(getCalendars()[0]?.timeZone ?? 'UTC');
  return isReadable(zone) ? zone : 'UTC';
}

const reportedZones = new Set<string>();

/**
 * The zone a screen draws a pack's day in. The rules throw on a name Intl can't read, and a pack's
 * zone comes from the phone that made it: an old Android here may not know Europe/Kyiv, and Home
 * would go down with that throw, and the way to Me with it. The phone's own zone is the best guess
 * at where the pack is, and the server decides every day that counts, so only what a screen shows
 * can be off. The developer hears of each such zone.
 */
export function readableZone(zone: string): string {
  if (isReadable(zone)) return zone;
  if (!reportedZones.has(zone)) {
    reportedZones.add(zone);
    reportError(new Error(`Pack time zone this phone can't read: ${zone}`));
  }
  return deviceTimeZone();
}

/** The month (YYYY-MM) `by` months before or after `month`. */
export function shiftMonth(month: string, by: number): string {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 2000, (number ?? 1) - 1 + by, 1));
  return date.toISOString().slice(0, 7);
}

/** A month (YYYY-MM) for display, like "September 2026". */
export function formatMonth(month: string): string {
  return formatter({ month: 'long', year: 'numeric' }).format(new Date(`${month}-15T12:00:00`));
}
