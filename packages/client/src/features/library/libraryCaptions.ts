import type { LibraryItem, TvSeason } from "@shelfie/shared";
import { episodeKey, STATUS_META_GROUP } from "@shelfie/shared";
import type { BookCardDoc } from "../../db/bookCards";
import type { GameCardDoc } from "../../db/gameCards";
import type { MovieCardDoc } from "../../db/movieCards";
import type { TvCardDoc } from "../../db/tvCards";
import { formatRuntime } from "../media/duration";
import { yearOf } from "../media/libraryActions";
import type { CardMeta } from "./useLibraryData";

/** Whole hours from IGDB seconds, e.g. 79200 -> 22. */
function toHours(seconds: number): number {
  return Math.round(seconds / 3600);
}

/** Game caption logic — unchanged from the pre-multi-media implementation. */
function formatProgress(
  item: LibraryItem,
  meta: GameCardDoc | undefined,
): string | null {
  const expected = meta?.timeToBeat?.normally ?? null;
  if (expected == null)
    return `${item.progressValue ?? 0}${item.progressFormat === "hours" ? "h" : "%"}`;

  let pct: number;
  if (item.progressFormat === "hours") {
    const h = item.progressValue ?? 0;
    if (h >= toHours(expected)) return `${h}h`;
    pct = (h / toHours(expected)) * 100;
  } else {
    pct = item.progressValue ?? 0;
    if (pct >= 100) return `${pct}%`;
  }

  pct = Math.round(pct);
  pct = Math.min(Math.max(pct, 0), 100);
  const left = toHours(expected * (1 - pct / 100));
  return pct > 0 ? `${pct}% · ${left}h left` : `~${left}h left`;
}

/** Game caption logic — unchanged from the pre-multi-media implementation.
 *  normally = IGDB "normally" seconds. */
function gameCaption(
  item: LibraryItem,
  meta: GameCardDoc | undefined,
): string | null {
  switch (STATUS_META_GROUP[item.status]) {
    case "in-progress": {
      return formatProgress(item, meta);
    }
    case "planned": {
      const expected = meta?.timeToBeat?.normally ?? null;
      return expected != null ? `~${toHours(expected)}h` : null;
    }
    case "finished": {
      return `${item.progressValue ?? 0}${item.progressFormat === "hours" ? "h" : "%"}`;
    }
  }
}

function movieCaption(meta: MovieCardDoc | undefined): string | null {
  const runtime = formatRuntime(meta?.runtime ?? null);
  if (runtime) return runtime;
  const year = yearOf(meta?.releaseDate);
  return year != null ? String(year) : null;
}

/** Excludes season-0 (Specials) keys from the numerator, matching the
 *  contract's derived-progress rule. */
function tvCaption(
  item: LibraryItem,
  meta: TvCardDoc | undefined,
): string | null {
  const watched = Object.keys(item.watchedEpisodes).filter(
    (k) => !k.startsWith("s0e"),
  ).length;
  if (meta?.numberOfEpisodes == null)
    return watched > 0 ? `${watched} ep` : null;
  return `${watched}/${meta.numberOfEpisodes} ep`;
}

export type NextEpisode = {
  season: number;
  episode: number;
  name: string;
  stillPath: string | null;
  airDate: string | null;
};

/** True only when the episode has a known air date on or before today.
 *  TMDB emits "" (not null) for unknown dates, so test truthiness, not just null. */
export function hasAired(ep: NextEpisode): boolean {
  return !!ep.airDate && ep.airDate <= new Date().toISOString().slice(0, 10);
}

/** First non-special episode (season >= 1) in air order not present in
 *  `watched`. null when every non-special episode is watched. */
export function nextUnwatched(
  seasons: TvSeason[],
  watched: Record<string, string>,
  skipKey?: string,
): NextEpisode | null {
  const ordered = [...seasons]
    .filter((s) => s.seasonNumber !== 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .flatMap((s) =>
      [...s.episodes]
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
        .map((ep) => ({
          season: s.seasonNumber,
          episode: ep.episodeNumber,
          name: ep.name,
          stillPath: ep.stillPath,
          airDate: ep.airDate,
        })),
    );
  for (const ep of ordered) {
    const key = episodeKey(ep.season, ep.episode);
    if (key !== skipKey && !(key in watched)) return ep;
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Airs today" / "Airs tomorrow" / "Airs Fri" (within a week) /
 *  "Airs Oct 20" / "Airs Oct 20, 2027", relative to `today` (local ISO day). */
export function airingLabel(airDate: string, today: string): string {
  const air = new Date(`${airDate}T00:00:00`);
  const days = Math.round(
    (air.getTime() - new Date(`${today}T00:00:00`).getTime()) / DAY_MS,
  );
  if (days <= 0) return "Airs today";
  if (days === 1) return "Airs tomorrow";
  if (days < 7)
    return `Airs ${air.toLocaleDateString(undefined, { weekday: "short" })}`;
  return `Airs ${air.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: airDate.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
  })}`;
}

export type UpcomingEpisode = {
  season: number;
  episode: number;
  airDate: string;
};

/** The dated, not-yet-aired episode a caught-up viewer is waiting on: the
 *  catalog's next unwatched episode when it has a date, else TMDB's
 *  `nextEpisodeToAir` from the card — which covers shows with no catalog
 *  loaded (not in progress) and catalogs cached before a new season was
 *  announced. Callers handle an already-aired `nextUp` themselves. */
export function upcomingEpisode(
  nextUp: NextEpisode | null,
  card: TvCardDoc | undefined,
  watched: Record<string, string>,
  today: string,
): UpcomingEpisode | null {
  if (nextUp?.airDate) {
    return {
      season: nextUp.season,
      episode: nextUp.episode,
      airDate: nextUp.airDate,
    };
  }
  const next = card?.nextEpisodeToAir;
  if (
    !next ||
    next.airDate < today ||
    episodeKey(next.seasonNumber, next.episodeNumber) in watched
  ) {
    return null;
  }
  return {
    season: next.seasonNumber,
    episode: next.episodeNumber,
    airDate: next.airDate,
  };
}

function bookCaption(
  item: LibraryItem,
  meta: BookCardDoc | undefined,
): string | null {
  if (item.progressFormat === "pages" && item.progressValue != null) {
    return meta?.pageCount != null
      ? `${item.progressValue}/${meta.pageCount} p`
      : `${item.progressValue} p`;
  }
  return meta?.pageCount != null ? `${meta.pageCount} p` : null;
}

/** Left-aligned caption beneath a card. null -> render no text (footer keeps
 *  the + button and its width). Dispatches per media type; every branch
 *  tolerates missing/not-yet-fetched metadata. */
export function cardCaption(
  item: LibraryItem,
  meta: CardMeta | undefined,
): string | null {
  switch (item.mediaType) {
    case "game":
      return gameCaption(item, meta as GameCardDoc | undefined);
    case "movie":
      return movieCaption(meta as MovieCardDoc | undefined);
    case "tv":
      return tvCaption(item, meta as TvCardDoc | undefined);
    case "book":
      return bookCaption(item, meta as BookCardDoc | undefined);
  }
}
