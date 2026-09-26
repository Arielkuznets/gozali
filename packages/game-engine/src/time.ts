import { DAY_END_HOUR, GRACE_MINUTES } from './constants.ts';
import type { WeekStart } from './types.ts';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Local wall-clock time of an instant in an IANA time zone. */
export function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** Minutes from the start of a pack day (DAY_END_HOUR local) to a local time of day. */
export function minutesIntoPackDay(hour: number, minute = 0): number {
  return ((hour - DAY_END_HOUR + 24) % 24) * 60 + minute;
}

/**
 * The pack day an instant belongs to. Pack days run from DAY_END_HOUR to DAY_END_HOUR
 * local time and are named by the date they start on, so 01:30 belongs to the day before.
 */
export function packDayOf(instant: Date, timeZone: string): string {
  const local = wallClock(instant, timeZone);
  const calendarDay = isoDate(local.year, local.month, local.day);
  return local.hour < DAY_END_HOUR ? addDays(calendarDay, -1) : calendarDay;
}

export function minuteOfPackDay(instant: Date, timeZone: string): number {
  const local = wallClock(instant, timeZone);
  return minutesIntoPackDay(local.hour, local.minute);
}

/** The instant at which a local date and hour happen in a time zone. */
export function zonedTimeToUtc(day: string, hour: number, timeZone: string): Date {
  const target = Date.parse(`${day}T00:00:00Z`) + hour * 60 * MS_PER_MINUTE;
  let guess = target;
  // Shift the guess by the zone offset; the second pass settles days with a DST change.
  for (let pass = 0; pass < 2; pass += 1) {
    const local = wallClock(new Date(guess), timeZone);
    const shown = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    guess += target - shown;
  }
  return new Date(guess);
}

/** The instant a pack day ends. Days with a DST change last 23 or 25 hours. */
export function dayEnd(day: string, timeZone: string): Date {
  return zonedTimeToUtc(addDays(day, 1), DAY_END_HOUR, timeZone);
}

/** The earliest instant a pack day can be closed: its end plus the grace window. */
export function closesAt(day: string, timeZone: string): Date {
  return new Date(dayEnd(day, timeZone).getTime() + GRACE_MINUTES * MS_PER_MINUTE);
}

/**
 * Days that can be closed at `now`, oldest first, starting from the first day without a
 * result. Deriving the list from state means a failed or late run catches up by itself.
 */
export function closableDays(firstOpenDay: string, now: Date, timeZone: string): string[] {
  const days: string[] = [];
  for (let day = firstOpenDay; closesAt(day, timeZone).getTime() <= now.getTime(); day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

/**
 * The pack day a feed counts for. Server time decides, except for a feed captured offline
 * before its day ended and received within that day's grace window.
 */
export function feedDay(receivedAt: Date, capturedAt: Date | null, timeZone: string): string {
  const receivedDay = packDayOf(receivedAt, timeZone);
  if (capturedAt === null || capturedAt.getTime() > receivedAt.getTime()) return receivedDay;
  const capturedDay = packDayOf(capturedAt, timeZone);
  if (capturedDay !== receivedDay && receivedAt.getTime() <= closesAt(capturedDay, timeZone).getTime()) {
    return capturedDay;
  }
  return receivedDay;
}

export function weekStartOf(day: string, weekStart: WeekStart): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const offset = weekStart === 'sunday' ? weekday : (weekday + 6) % 7;
  return addDays(day, -offset);
}

export function monthOf(day: string): string {
  return day.slice(0, 7);
}
