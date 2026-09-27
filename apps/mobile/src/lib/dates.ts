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
