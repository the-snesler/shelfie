import type {
  TvEpisode,
  TvLastAiring,
  TvMetadata,
  TvSeason,
} from "@shelfie/shared";
import { episodeKey } from "@shelfie/shared";

/** Ascending by seasonNumber, with Specials (0) pushed to the end. */
export function orderedSeasons(seasons: readonly TvSeason[]): TvSeason[] {
  return [...seasons].sort((a, b) => {
    if (a.seasonNumber === 0) return 1;
    if (b.seasonNumber === 0) return -1;
    return a.seasonNumber - b.seasonNumber;
  });
}

/**
 * Whether an episode has aired by `today` (a local ISO day). A dated episode
 * aired on or before its day. An undated regular episode counts as aired
 * only if it sits at or before TMDB's last aired episode — TMDB lists
 * announced episodes with no date yet. Undated specials stay toggleable,
 * since TMDB often lacks dates for old extras.
 */
export function isEpisodeAired(
  episode: Pick<TvEpisode, "seasonNumber" | "episodeNumber" | "airDate">,
  lastAired: Pick<TvLastAiring, "seasonNumber" | "episodeNumber"> | null,
  today: string,
): boolean {
  if (episode.airDate) return episode.airDate <= today;
  if (episode.seasonNumber === 0) return true;
  if (!lastAired || lastAired.seasonNumber === 0) return false;
  return (
    episode.seasonNumber < lastAired.seasonNumber ||
    (episode.seasonNumber === lastAired.seasonNumber &&
      episode.episodeNumber <= lastAired.episodeNumber)
  );
}

export interface NextUp {
  episode: TvEpisode;
  /** False when every aired episode is watched and this one is upcoming. */
  aired: boolean;
}

/**
 * The episode to watch next: the first unwatched aired regular episode in
 * season order, else the first unwatched upcoming one. Specials never count
 * (they are excluded from progress too). Null when everything listed is
 * watched.
 */
export function nextUpEpisode(
  seasons: readonly TvSeason[],
  watched: Record<string, string>,
  lastAired: Pick<TvLastAiring, "seasonNumber" | "episodeNumber"> | null,
  today: string,
): NextUp | null {
  let upcoming: TvEpisode | null = null;
  for (const season of orderedSeasons(seasons)) {
    if (season.seasonNumber === 0) continue;
    for (const episode of season.episodes) {
      if (episodeKey(episode.seasonNumber, episode.episodeNumber) in watched)
        continue;
      if (isEpisodeAired(episode, lastAired, today))
        return { episode, aired: true };
      upcoming ??= episode;
    }
  }
  return upcoming ? { episode: upcoming, aired: false } : null;
}

export interface EpisodeProgress {
  /** Watched regular (non-special) episodes. */
  watched: number;
  /** Regular episodes aired so far; falls back to `total` for old cards. */
  aired: number;
  /** Listed regular episodes, including announced ones. */
  total: number;
}

/** Progress against what has aired, not just what TMDB lists, so a show
 *  still airing can read as caught up. */
export function episodeProgress(
  watched: Record<string, string>,
  card: Pick<TvMetadata, "airedEpisodes" | "numberOfEpisodes">,
): EpisodeProgress {
  const total = card.numberOfEpisodes;
  return {
    watched: Object.keys(watched).filter((key) => !key.startsWith("s0e"))
      .length,
    aired: Math.min(card.airedEpisodes ?? total, total),
    total,
  };
}
