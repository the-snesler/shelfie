import type { ItemStatus, LibraryItem, MediaType } from "@shelfie/shared";
import { defaultLogFormat } from "@shelfie/shared";

/** Everything a log/status action needs to know about the thing being
 *  logged, independent of media type — replaces the game-only `LogGame`. */
export interface LogTarget {
  mediaType: MediaType;
  sourceId: string;
  name: string;
  /** IGDB platform names; always [] for non-game media. */
  platforms: string[];
}

/** Builds a fresh backlog-ready LibraryItem doc (same shape Detail inserts today). */
export function newLibraryItem(
  target: LogTarget,
  status: ItemStatus,
): LibraryItem {
  const now = Date.now();
  return {
    id: `${target.mediaType}:${target.sourceId}`,
    mediaType: target.mediaType,
    sourceId: target.sourceId,
    status,
    progressFormat: defaultLogFormat(target.mediaType),
    progressValue: null,
    platforms: [],
    rating: null,
    completedDates: [],
    notes: "",
    watchedEpisodes: [],
    addedAt: now,
    updatedAt: now,
  };
}
