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
  /** Best-known release date as YYYY-MM-DD, or null when unknown. Drives the
   *  "Release date" quick-fill in the completion prompt; unused by newLibraryItem. */
  releaseDate?: string | null;
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

/** epoch seconds -> UTC YYYY-MM-DD (IGDB firstReleaseDate). */
export function releaseDateFromEpoch(seconds: number | null): string | null {
  return seconds == null
    ? null
    : new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** year -> YYYY-01-01 (movie/tv/book card caches only carry a year). */
export function releaseDateFromYear(year: number | null): string | null {
  return year == null ? null : `${String(year).padStart(4, "0")}-01-01`;
}
