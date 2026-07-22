import type { LibraryItem, TvSeason } from "@shelfie/shared";
import { episodeKey, STATUS_META_GROUP } from "@shelfie/shared";
import type { BookCardDoc } from "../../db/bookCards";
import type { GameCardDoc } from "../../db/gameCards";
import type { MovieCardDoc } from "../../db/movieCards";
import type { TvCardDoc } from "../../db/tvCards";
import { formatRuntime } from "../media/duration";
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
  if (meta?.year != null) return String(meta.year);
  return null;
}

/** Excludes season-0 (Specials) keys from the numerator, matching the
 *  contract's derived-progress rule. */
function tvCaption(
  item: LibraryItem,
  meta: TvCardDoc | undefined,
): string | null {
  const watched = item.watchedEpisodes.filter(
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
};

/** First non-special episode (season >= 1) in air order not present in
 *  `watched`. null when every non-special episode is watched. */
export function nextUnwatched(
  seasons: TvSeason[],
  watched: string[],
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
        })),
    );
  for (const ep of ordered) {
    const key = episodeKey(ep.season, ep.episode);
    if (key !== skipKey && !watched.includes(key)) return ep;
  }
  return null;
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
