import {
  canonicalDocKey,
  dayCouldHold,
  defaultLogFormat,
  isInstant,
  libraryItemDocSchema,
  type ItemStatus,
  type Moment,
  type ReplicatedLibraryItem,
} from "@tsundo/shared";
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

/** Whether `instant` is a more precise record of the bare `day`: the same
 *  finish, if the owner's time zone puts the instant on that day. */
function sharpens(day: string | undefined, instant: Moment): boolean {
  return (
    day !== undefined &&
    !isInstant(day) &&
    isInstant(instant) &&
    dayCouldHold(day, instant)
  );
}

/**
 * The item's completions plus the source's. A timed completion replaces a
 * bare day that could be the same finish (from a manual log, or an import
 * that predates instants) rather than being added beside it; each day
 * absorbs at most one instant, so a same-day rewatch still adds one.
 */
export function mergeCompletions(
  current: readonly Moment[],
  incoming: readonly Moment[],
): Moment[] {
  const merged = [...current];
  for (const moment of incoming) {
    if (merged.includes(moment)) continue;
    const day = merged.findIndex((existing) => sharpens(existing, moment));
    if (day >= 0) merged[day] = moment;
    else if (!merged.some((existing) => sharpens(moment, existing)))
      merged.push(moment);
  }
  return [...new Set(merged)].sort().slice(-100);
}

/**
 * The item's watched episodes plus the source's. The owner's entries win,
 * except that a source instant fills in an unknown ("") or bare-day watch
 * of the same episode on a day the instant could fall on.
 */
function mergeWatchedEpisodes(
  current: Readonly<Record<string, Moment | "">>,
  incoming: Readonly<Record<string, Moment | "">>,
): Record<string, Moment | ""> {
  const merged = { ...incoming, ...current };
  for (const [key, moment] of Object.entries(incoming)) {
    const mine = current[key];
    if (moment && isInstant(moment) && (mine === "" || sharpens(mine, moment)))
      merged[key] = moment;
  }
  return merged;
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
      completions: incoming.completions ?? [],
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
    completions: mergeCompletions(
      current.completions,
      incoming.completions ?? [],
    ),
    watchedEpisodes: mergeWatchedEpisodes(
      current.watchedEpisodes,
      incoming.watchedEpisodes ?? {},
    ),
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
