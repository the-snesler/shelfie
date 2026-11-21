import {
  canonicalDocKey,
  defaultLogFormat,
  libraryItemDocSchema,
  type ItemStatus,
  type ReplicatedLibraryItem,
} from "@shelfie/shared";
import type { ImportedItem } from "./types.js";

/**
 * Statuses an import may move an existing item to when the item's status
 * in the source changes. Only forward: dropped, finished and completed are
 * never changed, and an active item is never paused (Steam reports "not
 * played lately", not a choice to pause).
 */
const STATUS_ADVANCES: Partial<Record<ItemStatus, ItemStatus[]>> = {
  wishlisted: ["backlogged", "active", "paused", "finished", "completed"],
  backlogged: ["active", "paused", "finished", "completed"],
  paused: ["active", "finished", "completed"],
  active: ["finished", "completed"],
};

export interface MergeOptions {
  /**
   * Whether the source's status may move an existing item forward. The
   * service passes true only when the policy allows it and the status in the
   * source changed since the last import, so a manual status sticks.
   */
  updateStatus?: boolean;
}

/** Periodic imports are additive: preserve deliberate local edits and tombstones. */
export function mergeImportedItem(
  incoming: ImportedItem,
  current: ReplicatedLibraryItem | null,
  now: number,
  { updateStatus = true }: MergeOptions = {},
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
      storefront: incoming.storefront ?? null,
      completedDates: incoming.completedDates ?? [],
      notes: "",
      watchedEpisodes: incoming.watchedEpisodes ?? {},
      activity: [],
      addedAt: now,
      updatedAt: now,
      _deleted: false,
    });
  }
  // Movies and TV never expose "wishlisted"; earlier Trakt imports wrote it
  // anyway, so repair those to the planned status they do expose.
  const currentStatus =
    current.status === "wishlisted" &&
    (current.mediaType === "movie" || current.mediaType === "tv")
      ? "backlogged"
      : current.status;
  const status =
    updateStatus && STATUS_ADVANCES[currentStatus]?.includes(incoming.status)
      ? incoming.status
      : currentStatus;
  const merged = {
    ...current,
    status,
    rating: current.rating ?? incoming.rating ?? null,
    // A store the user picked wins; an import only fills an unset one.
    storefront: current.storefront ?? incoming.storefront ?? null,
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
  if (canonicalDocKey(merged) === canonicalDocKey(current)) return null;
  return libraryItemDocSchema.parse({
    ...merged,
    updatedAt: Math.max(now, current.updatedAt + 1),
  });
}
