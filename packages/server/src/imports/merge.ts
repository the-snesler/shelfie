import {
  canonicalDocKey,
  defaultLogFormat,
  libraryItemDocSchema,
  type ItemStatus,
  type ReplicatedLibraryItem,
} from "@shelfie/shared";
import type { ImportedItem } from "./types.js";

/**
 * Book statuses an import may move forward, as reading progresses in the
 * source. Dropped, finished and completed are never changed by an import.
 */
const BOOK_ADVANCES: Partial<Record<ItemStatus, ItemStatus[]>> = {
  wishlisted: ["active", "finished"],
  backlogged: ["active", "finished"],
  active: ["finished"],
  paused: ["finished"],
};

function withFallbackDate(
  completedDates: string[],
  status: ItemStatus,
  fallback: string | undefined,
): string[] {
  return fallback && status === "finished" && completedDates.length === 0
    ? [fallback]
    : completedDates;
}

/** Periodic imports are additive: preserve deliberate local edits and tombstones. */
export function mergeImportedItem(
  incoming: ImportedItem,
  current: ReplicatedLibraryItem | null,
  now: number,
): ReplicatedLibraryItem | null {
  if (current?._deleted) return null;
  if (!current) {
    return libraryItemDocSchema.parse({
      id: `${incoming.mediaType}:${incoming.sourceId}`,
      mediaType: incoming.mediaType,
      sourceId: incoming.sourceId,
      status: incoming.status,
      progressFormat:
        incoming.progressFormat ?? defaultLogFormat(incoming.mediaType),
      progressValue: incoming.progressValue ?? null,
      platforms: incoming.platforms ?? [],
      rating: incoming.rating ?? null,
      excitement: null,
      completedDates: withFallbackDate(
        incoming.completedDates ?? [],
        incoming.status,
        incoming.fallbackCompletedDate,
      ),
      notes: "",
      watchedEpisodes: incoming.watchedEpisodes ?? {},
      activity: [],
      addedAt: now,
      updatedAt: now,
      _deleted: false,
    });
  }
  // Reading progress comes from the source; other media keep local statuses.
  const status =
    incoming.mediaType === "book" &&
    BOOK_ADVANCES[current.status]?.includes(incoming.status)
      ? incoming.status
      : current.status;
  const merged = {
    ...current,
    status,
    rating: current.rating ?? incoming.rating ?? null,
    completedDates: [
      ...new Set([
        ...current.completedDates,
        ...(incoming.completedDates ?? []),
      ]),
    ]
      .sort()
      .slice(-100),
    watchedEpisodes: {
      ...(incoming.watchedEpisodes ?? {}),
      ...current.watchedEpisodes,
    },
    progressValue:
      current.progressValue === null &&
      current.progressFormat === incoming.progressFormat
        ? (incoming.progressValue ?? null)
        : current.progressValue,
  };
  // Steam playtime and source reading progress can advance without
  // replacing a manually chosen progress unit.
  const advancingUnit =
    incoming.mediaType === "game"
      ? "hours"
      : incoming.mediaType === "book"
        ? "percent"
        : null;
  if (
    advancingUnit &&
    current.progressFormat === advancingUnit &&
    incoming.progressFormat === advancingUnit &&
    incoming.progressValue != null
  ) {
    merged.progressValue = Math.max(
      current.progressValue ?? 0,
      incoming.progressValue,
    );
  }
  merged.completedDates = withFallbackDate(
    merged.completedDates,
    merged.status,
    incoming.fallbackCompletedDate,
  );
  if (canonicalDocKey(merged) === canonicalDocKey(current)) return null;
  return libraryItemDocSchema.parse({
    ...merged,
    updatedAt: Math.max(now, current.updatedAt + 1),
  });
}
