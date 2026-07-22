/** Human-friendly runtime from a minute count.
 *  90 -> "1h 30m", 145 -> "2h 25m", 60 -> "1h", 45 -> "45m".
 *  Returns null for null/0 (nothing to show). */
export function formatRuntime(
  minutes: number | null | undefined,
): string | null {
  if (minutes == null || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
