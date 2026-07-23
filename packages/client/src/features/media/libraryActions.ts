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
    watchedEpisodes: {},
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

/** Local-time YYYY-MM-DD for today (avoids toISOString's UTC off-by-one). */
export function todayLocalIsoDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Derives the next `watchedEpisodes`/`status`/`completedDates` for a TV
 *  item from an episode-map updater — the single source of truth every
 *  episode-toggle call site (TvDetail's checkboxes, the library grid's
 *  "next episode" quick-check) must share so status derivation never
 *  drifts between them. Watching every known episode (`total`, from show
 *  metadata) marks the item "finished" and appends today's date (deduped);
 *  dropping back below 100% reverts a "finished" item to "active".
 *  `completedDates` are only ever appended here, never removed. */
export function deriveEpisodeWatch(
  current: {
    watchedEpisodes: Record<string, string>;
    status: ItemStatus;
    completedDates: string[];
  },
  total: number,
  updater: (current: Record<string, string>) => Record<string, string>,
): {
  watchedEpisodes: Record<string, string>;
  status: ItemStatus;
  completedDates: string[];
} {
  const watchedEpisodes = updater(current.watchedEpisodes);
  const watchedNonSpecial = Object.keys(watchedEpisodes).filter(
    (k) => !k.startsWith("s0e"),
  ).length;
  const allWatched = total > 0 && watchedNonSpecial === total;
  let status = current.status;
  let completedDates = current.completedDates;
  if (allWatched && status !== "finished" && status !== "completed") {
    status = "finished";
    const today = todayLocalIsoDate();
    if (!completedDates.includes(today))
      completedDates = [...completedDates, today];
  } else if (!allWatched && status === "finished") {
    status = "active";
  }
  return { watchedEpisodes, status, completedDates };
}
