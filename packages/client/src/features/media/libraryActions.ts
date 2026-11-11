import type {
  ItemStatus,
  LibraryItem,
  MediaType,
  TvProgressCard,
} from "@shelfie/shared";
import { defaultLogFormat, tvWatchState } from "@shelfie/shared";

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
    excitement: null,
    completedDates: [],
    notes: "",
    watchedEpisodes: {},
    activity: [],
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

/** year -> YYYY-01-01 (the TV card cache only carries a first-air year). */
export function releaseDateFromYear(year: number | null): string | null {
  return year == null ? null : `${String(year).padStart(4, "0")}-01-01`;
}

/** YYYY-MM-DD -> its year, for UI that shows only the year. */
export function yearOf(isoDate: string | null | undefined): number | null {
  return isoDate ? Number(isoDate.slice(0, 4)) : null;
}

/** Local-time YYYY-MM-DD for `d` (avoids toISOString's UTC off-by-one). */
export function localIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local-time YYYY-MM-DD for today. */
export function todayLocalIsoDate(): string {
  return localIsoDate(new Date());
}

/** The TV card fields episode toggles read: the shared progress rule's
 *  inputs, plus the listed-episode count as a fallback for cards cached
 *  before those fields existed. */
export type EpisodeWatchCard = TvProgressCard & { numberOfEpisodes: number };

/** Derives the next `watchedEpisodes`/`status`/`completedDates` for a TV
 *  item from an episode-map updater — the single source of truth every
 *  episode-toggle call site (TvDetail's checkboxes, the library grid's
 *  "next episode" quick-check) must share so status derivation never
 *  drifts between them. Follows the shared `tvWatchState` rule (which the
 *  server's hourly TV progress pass also applies): finishing the season
 *  marks the item "finished" and appends today's date (deduped); being
 *  caught up on a show that is still airing, or falling behind, reverts a
 *  "finished" item to "active". `completedDates` are only ever appended
 *  here, never removed. */
export function deriveEpisodeWatch(
  current: {
    watchedEpisodes: Record<string, string>;
    status: ItemStatus;
    completedDates: string[];
  },
  card: EpisodeWatchCard | null | undefined,
  updater: (current: Record<string, string>) => Record<string, string>,
): {
  watchedEpisodes: Record<string, string>;
  status: ItemStatus;
  completedDates: string[];
} {
  const watchedEpisodes = updater(current.watchedEpisodes);
  const today = todayLocalIsoDate();
  const state = tvWatchState(watchedEpisodes, card, today);
  let seasonOver: boolean;
  if (state) {
    seasonOver = state === "season-over";
  } else {
    // Card predates the progress fields: every listed episode watched.
    const total = card?.numberOfEpisodes ?? 0;
    const watchedRegular = Object.keys(watchedEpisodes).filter(
      (k) => !k.startsWith("s0e"),
    ).length;
    seasonOver = total > 0 && watchedRegular === total;
  }
  let status = current.status;
  let completedDates = current.completedDates;
  if (seasonOver && status !== "finished" && status !== "completed") {
    status = "finished";
    if (!completedDates.includes(today))
      completedDates = [...completedDates, today];
  } else if (!seasonOver && status === "finished") {
    status = "active";
  }
  return { watchedEpisodes, status, completedDates };
}
