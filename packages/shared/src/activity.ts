import type { ActivityChanges, ItemActivity, LibraryItem } from "./types.js";
import { canonicalDocKey } from "./conflict.js";

const FIELDS = [
  "status",
  "progressFormat",
  "progressValue",
  "platforms",
  "rating",
  "completedDates",
  "notes",
] as const;

/** Union by event id so offline edits survive conflict resolution and imports. */
export function mergeActivity(
  a: readonly ItemActivity[],
  b: readonly ItemActivity[],
): ItemActivity[] {
  const events = new Map<string, ItemActivity>();
  for (const event of [...a, ...b]) {
    const existing = events.get(event.id);
    if (!existing || canonicalDocKey(event) > canonicalDocKey(existing))
      events.set(event.id, event);
  }
  return [...events.values()].sort(
    (a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Called only for local writes. Replication and migration never invent events. */
export function recordItemActivity(
  next: LibraryItem,
  previous: LibraryItem | undefined,
  at: number,
  id: string,
): void {
  const previousIds = new Set(previous?.activity.map((event) => event.id));
  const explicitEvents = next.activity.filter(
    (event) => !previousIds.has(event.id),
  );
  const changes: ActivityChanges = {};
  for (const field of FIELDS) {
    if (
      !previous ||
      canonicalDocKey({ value: next[field] }) !==
        canonicalDocKey({ value: previous[field] })
    ) {
      Object.assign(changes, { [field]: next[field] });
    }
  }
  const episodes: Record<string, string | null> = {};
  for (const key of new Set([
    ...Object.keys(previous?.watchedEpisodes ?? {}),
    ...Object.keys(next.watchedEpisodes),
  ])) {
    if (previous?.watchedEpisodes[key] !== next.watchedEpisodes[key])
      episodes[key] = next.watchedEpisodes[key] ?? null;
  }
  if (Object.keys(episodes).length) changes.watchedEpisodes = episodes;
  // Record the unit with each value so later format changes cannot relabel history.
  if (changes.progressValue !== undefined)
    changes.progressFormat = next.progressFormat;
  if (!previous) {
    if (next.progressValue === null) {
      delete changes.progressValue;
      delete changes.progressFormat;
    }
    if (next.rating === null) delete changes.rating;
    if (!next.platforms.length) delete changes.platforms;
    if (!next.completedDates.length) delete changes.completedDates;
    if (!next.notes) delete changes.notes;
  }
  next.activity = mergeActivity(previous?.activity ?? [], next.activity);
  for (const event of explicitEvents) {
    for (const field of Object.keys(event.changes))
      delete changes[field as keyof ActivityChanges];
  }
  if (Object.keys(changes).length)
    next.activity = mergeActivity(next.activity, [{ id, at, changes }]);
}
