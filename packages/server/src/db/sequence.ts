/**
 * Per-collection monotonic sequence counters. Each synced table owns an
 * independent, gapless cursor; replication checkpoints are per-collection too.
 */
const counters = new Map<string, number>();

export function initSequence(table: string, maxSeq: number): void {
  counters.set(table, maxSeq);
}

export function nextRev(table: string): number {
  const next = (counters.get(table) ?? 0) + 1;
  counters.set(table, next);
  return next;
}
