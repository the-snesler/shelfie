const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const SHORT_DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

/** Parses an ISO "YYYY-MM-DD" day as a local date (not UTC midnight, which
 *  would show the previous day west of Greenwich). */
function localDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/** "Jul 6, 2026" for an ISO day; null in, null out. */
export function formatIsoDay(iso: string | null | undefined): string | null {
  return iso ? DAY_FORMAT.format(localDay(iso)) : null;
}

/** "Jul 6" for an ISO day, adding the year only when it differs from the
 *  `today` ISO day's year. */
export function formatIsoDayShort(iso: string, today: string): string {
  return iso.slice(0, 4) === today.slice(0, 4)
    ? SHORT_DAY_FORMAT.format(localDay(iso))
    : DAY_FORMAT.format(localDay(iso));
}

/** "Jul 6 – Sep 21, 2026" style range between two ISO days. */
export function formatIsoDayRange(
  from: string | null | undefined,
  to: string | null | undefined,
): string | null {
  if (!from) return null;
  if (!to || to === from) return formatIsoDay(from);
  return DAY_FORMAT.formatRange(localDay(from), localDay(to));
}
