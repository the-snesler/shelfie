import { canonicalDocKey, defaultLogFormat, libraryItemDocSchema, type ReplicatedLibraryItem } from "@shelfie/shared";
import type { ImportedItem } from "./types.js";

/** Periodic imports are additive: preserve deliberate local edits and tombstones. */
export function mergeImportedItem(incoming: ImportedItem, current: ReplicatedLibraryItem | null, now: number): ReplicatedLibraryItem | null {
  if (current?._deleted) return null;
  if (!current) {
    return libraryItemDocSchema.parse({ id: `${incoming.mediaType}:${incoming.sourceId}`, mediaType: incoming.mediaType, sourceId: incoming.sourceId, status: incoming.status, progressFormat: incoming.progressFormat ?? defaultLogFormat(incoming.mediaType), progressValue: incoming.progressValue ?? null, platforms: incoming.platforms ?? [], rating: incoming.rating ?? null, completedDates: incoming.completedDates ?? [], notes: "", watchedEpisodes: incoming.watchedEpisodes ?? {}, activity: [], addedAt: now, updatedAt: now, _deleted: false });
  }
  const merged = {
    ...current,
    rating: current.rating ?? incoming.rating ?? null,
    completedDates: [...new Set([...current.completedDates, ...(incoming.completedDates ?? [])])].sort().slice(-100),
    watchedEpisodes: { ...(incoming.watchedEpisodes ?? {}), ...current.watchedEpisodes },
    progressValue: current.progressValue === null && current.progressFormat === incoming.progressFormat ? incoming.progressValue ?? null : current.progressValue,
  };
  // Steam playtime can advance without replacing a manually chosen progress unit.
  if (incoming.mediaType === "game" && current.progressFormat === "hours" && incoming.progressFormat === "hours" && incoming.progressValue != null) {
    merged.progressValue = Math.max(current.progressValue ?? 0, incoming.progressValue);
  }
  if (canonicalDocKey(merged) === canonicalDocKey(current)) return null;
  return libraryItemDocSchema.parse({ ...merged, updatedAt: Math.max(now, current.updatedAt + 1) });
}
