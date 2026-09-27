const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/** A pack day (YYYY-MM-DD) for display, like "Fri, Oct 2". Noon avoids time zone edges. */
export function formatDay(day: string): string {
  return dayFormat.format(new Date(`${day}T12:00:00`));
}
