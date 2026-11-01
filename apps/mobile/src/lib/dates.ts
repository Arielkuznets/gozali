import { packDayOf } from '@gozali/game-engine';
import { getCalendars } from 'expo-localization';

import i18n from '@/i18n';

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

/** A moment as a time today, or with the date on other days. */
export function formatMoment(at: string, now: Date): string {
  const date = new Date(at);
  const time = formatter({ hour: '2-digit', minute: '2-digit' }).format(date);
  if (date.toDateString() === now.toDateString()) return time;
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

/** Me draws the pack day in this zone, and it is the way to Settings and Delete account. */
function isReadable(zone: string): boolean {
  try {
    packDayOf(new Date(), zone);
    return true;
  } catch {
    return false;
  }
}

/** The phone's time zone, like "Asia/Jerusalem". */
export function deviceTimeZone(): string {
  const zone = namedZone(getCalendars()[0]?.timeZone ?? 'UTC');
  return isReadable(zone) ? zone : 'UTC';
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
