import type { ItemActivity, LogFormat } from "@shelfie/shared";

export type ProgressLine =
  | {
      kind: "logged";
      format: LogFormat;
      /** Added since the previous entry in this run. */
      amount: number;
      /** The total this entry brought progress to. */
      total: number;
    }
  | { kind: "cleared" };

/**
 * Turns the absolute progress values stored in activity into the amounts
 * the timeline shows ("Logged 7 hours", not "Logged 12 hours"). Percent
 * is the exception and reads as the total ("Reached 55%"); each line
 * carries both, and `describeProgressLine` picks one.
 *
 * Activity is append-only (sync and CSV import union events by id, so
 * stored events can't be reliably rewritten or deleted). Corrections are
 * resolved here instead: lowering the total doesn't add an entry. It drops
 * the trailing entries the new total undoes and rewrites the earliest of
 * them to the corrected total, keeping that entry's timestamp. Going 5h →
 * 100h → 10h shows "Logged 5", "Logged 5". Going 5h → 2h shows a single
 * "Logged 2". Clearing progress or switching units starts a new run;
 * earlier runs stay as they were.
 *
 * Returns event id → line. An event with a progress change but no entry
 * here was undone by a later correction, so its progress line is hidden.
 */
export function progressLines(
  activity: readonly ItemActivity[],
  fallbackFormat: LogFormat,
): Map<string, ProgressLine> {
  const lines = new Map<string, ProgressLine>();
  let format: LogFormat | null = null;
  let run: { id: string; value: number }[] = [];

  const flush = () => {
    let previous = 0;
    for (const { id, value } of run) {
      lines.set(id, {
        kind: "logged",
        format: format ?? fallbackFormat,
        amount: Math.round((value - previous) * 100) / 100,
        total: value,
      });
      previous = value;
    }
    run = [];
  };

  for (const event of activity) {
    const value = event.changes.progressValue;
    if (value === undefined) continue;
    if (value === null) {
      flush();
      format = null;
      lines.set(event.id, { kind: "cleared" });
      continue;
    }
    const eventFormat = event.changes.progressFormat ?? fallbackFormat;
    if (eventFormat !== format) {
      flush();
      format = eventFormat;
    }
    if (value > (run.at(-1)?.value ?? 0)) {
      run.push({ id: event.id, value });
      continue;
    }
    let earliestUndone: string | undefined;
    while ((run.at(-1)?.value ?? -Infinity) >= value)
      earliestUndone = run.pop()?.id;
    if (earliestUndone && value > (run.at(-1)?.value ?? 0))
      run.push({ id: earliestUndone, value });
  }
  flush();
  return lines;
}

export function describeProgressLine(line: ProgressLine): string {
  if (line.kind === "cleared") return "Cleared progress";
  // "Logged 15%" reads oddly; a percentage is a position, not a quantity.
  if (line.format === "percent") return `Reached ${line.total}%`;
  const unit = line.format === "hours" ? "hour" : "page";
  return `Logged ${line.amount} ${unit}${line.amount === 1 ? "" : "s"}`;
}
