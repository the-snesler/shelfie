import { latestMoment, type Moment } from "./moments.js";
import type { TvMetadata } from "./tv.js";
import { episodeKey } from "./types.js";

/**
 * How long a caught-up show with no finale tag and nothing scheduled waits
 * before counting as over. TMDB sometimes lists next week's episode late, or
 * nobody tags the finale; a month separates those from a real season break.
 */
export const TV_SEASON_GRACE_DAYS = 30;

/**
 * - `behind`: an aired regular episode is unwatched.
 * - `caught-up`: every aired episode watched, more expected soon.
 * - `season-over`: every aired episode watched and the season (or show) has
 *   ended, so the show counts as Watched until new episodes air.
 */
export type TvWatchState = "behind" | "caught-up" | "season-over";

/** The card fields the rule reads; satisfied by `TvMetadata` and the client
 *  card cache. */
export type TvProgressCard = Pick<
  TvMetadata,
  "lastEpisodeToAir" | "airedEpisodes" | "nextEpisodeToAir"
>;

const DAY_MS = 24 * 60 * 60 * 1000;

function regularKeys(watched: Record<string, string>): string[] {
  return Object.keys(watched).filter((key) => !key.startsWith("s0e"));
}

/**
 * Where a watcher stands against what has aired, from episode data alone
 * (never TMDB's show status, which stays "Returning Series" across gaps of
 * years). Null when the card can't say: missing, or nothing aired yet.
 * Shared by the client's episode toggles, the library's caught-up tile and
 * the server's hourly TV progress pass, so they always agree.
 *
 * @param today local (client) or UTC (server) ISO day.
 */
export function tvWatchState(
  watchedEpisodes: Record<string, string>,
  card: TvProgressCard | null | undefined,
  today: string,
): TvWatchState | null {
  const last = card?.lastEpisodeToAir;
  const aired = card?.airedEpisodes;
  if (!last || aired == null || aired <= 0) return null;
  if (regularKeys(watchedEpisodes).length < aired) return "behind";
  if (last.episodeType === "finale") return "season-over";
  if (card.nextEpisodeToAir) return "caught-up";
  if (last.episodeType === "mid_season") return "season-over";
  const since =
    Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last.airDate}T00:00:00Z`);
  return since >= TV_SEASON_GRACE_DAYS * DAY_MS ? "season-over" : "caught-up";
}

/**
 * When a caught-up watcher finished: the moment they watched the latest
 * aired episode, else their latest known watch. Null when no watch moment is
 * known (e.g. Trakt's "date unknown" history).
 */
export function tvFinishedMoment(
  watchedEpisodes: Record<string, string>,
  card: TvProgressCard | null | undefined,
): Moment | null {
  const last = card?.lastEpisodeToAir;
  const lastWatch = last
    ? watchedEpisodes[episodeKey(last.seasonNumber, last.episodeNumber)]
    : undefined;
  if (lastWatch) return lastWatch;
  return latestMoment(
    regularKeys(watchedEpisodes)
      .map((key) => watchedEpisodes[key])
      .filter(Boolean),
  );
}
