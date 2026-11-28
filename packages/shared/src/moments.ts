/**
 * When the user finished something (a completion, a watched episode), stored
 * as precisely as it is known:
 *
 * - an **instant**, `YYYY-MM-DDTHH:mm:ss.sssZ` (UTC, exactly what
 *   `Date#toISOString()` produces), when the time is known;
 * - a bare **day**, `YYYY-MM-DD`, when only the day is known: data from
 *   before schema v10, a day picked without a time, a release-date
 *   completion. A bare day is already the owner's local day.
 *
 * An instant always marks the moment the user *finished*: the end of the
 * film, episode or book, never its start. Sources are taken at their word:
 * Trakt's `watched_at` is only a start time for scrobbles, which history
 * doesn't flag, so it is imported unchanged. For books and games the start of the final session is meaningless and
 * unknowable, so the end is the only moment that applies to every medium.
 *
 * Instants are stored in UTC and turned into local days only for display,
 * by the client in the viewer's time zone. The server never derives a local
 * day from one, so a server that thinks it is in UTC (or sits in another
 * zone) cannot shift a watch onto the wrong day.
 */
export type Moment = string;

const DAY = String.raw`\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])`;
const TIME = String.raw`T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z`;
/** Matches a valid {@link Moment}: a bare day or a canonical UTC instant. */
export const MOMENT_PATTERN = new RegExp(`^${DAY}(?:${TIME})?$`);
/** Longest {@link Moment} (`YYYY-MM-DDTHH:mm:ss.sssZ`). */
export const MOMENT_MAX_LENGTH = 24;

export function isMoment(value: unknown): value is Moment {
  return typeof value === "string" && MOMENT_PATTERN.test(value);
}

/** Whether `moment` carries a time (an instant) rather than a bare day. */
export function isInstant(moment: Moment): boolean {
  return moment.length > 10;
}

/** The instant for `date` (defaults to now) as a {@link Moment}. */
export function instantMoment(date: Date | number = new Date()): Moment {
  return new Date(date).toISOString();
}

function localParts(ms: number) {
  const d = new Date(ms);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return {
    day: `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`,
  };
}

/**
 * The local day `moment` falls on, in the runtime's time zone: a bare day as
 * is, an instant converted. Client-side only; the server must not call this
 * (see {@link Moment}).
 */
export function momentDay(moment: Moment): string {
  return isInstant(moment) ? localParts(Date.parse(moment)).day : moment;
}

/**
 * A string key that orders moments chronologically in the runtime's time
 * zone: the local day, then the local time when known. A bare day sorts
 * before every instant on the same day, since when that day it happened is
 * unknown. Client-side only, like {@link momentDay}.
 */
export function momentSortKey(moment: Moment): string {
  if (!isInstant(moment)) return moment;
  const { day, time } = localParts(Date.parse(moment));
  return `${day}T${time}`;
}

/** Chronological comparator over {@link momentSortKey}, oldest first. */
export function compareMoments(a: Moment, b: Moment): number {
  const ka = momentSortKey(a);
  const kb = momentSortKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/** The latest of `moments` by {@link compareMoments}, or null when empty. */
export function latestMoment(moments: Iterable<Moment>): Moment | null {
  let latest: Moment | null = null;
  for (const moment of moments)
    if (latest === null || compareMoments(moment, latest) > 0) latest = moment;
  return latest;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a bare `day` could be the owner's local day for `instant`, in any
 * time zone (UTC−12 to UTC+14). Lets the server, which knows no time zone,
 * match an imported instant to a day the owner logged by hand.
 */
export function dayCouldHold(day: string, instant: Moment): boolean {
  const start = Date.parse(`${day}T00:00:00Z`);
  const at = Date.parse(instant);
  return (
    at >= start - 14 * 60 * 60 * 1000 &&
    at < start + DAY_MS + 12 * 60 * 60 * 1000
  );
}
