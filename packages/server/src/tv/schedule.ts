import type { TvAiring, TvScheduledEpisode, TvSeason } from "@shelfie/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * True when a TV row's `nextEpisodeToAir` has aired since the row was
 * fetched, so the cached "next episode" is known-outdated. TMDB air dates
 * are the broadcaster's local day and TMDB rolls `next_episode_to_air`
 * forward some hours after airing, so wait until two UTC midnights past the
 * air date before expiring — and expire at most once per airing (a fetch
 * after that point is fresh even if TMDB still reports the same episode).
 */
export function nextEpisodeExpired(
  next: TvAiring | null,
  fetchedAt: number,
  now: number,
): boolean {
  if (!next) return false;
  const airedAt = Date.parse(`${next.airDate}T00:00:00Z`);
  if (Number.isNaN(airedAt)) return false;
  const boundary = airedAt + 2 * DAY_MS;
  return now >= boundary && fetchedAt < boundary;
}

/**
 * Every dated episode of one cached show airing within [from, to] (ISO
 * days, inclusive): the cached season catalog when the detail tier has been
 * fetched, plus the card tier's `nextEpisodeToAir` — which covers shows
 * whose detail was never fetched, or whose cached catalog predates a newly
 * announced season. Deduped by season/episode, catalog entry winning.
 */
export function scheduleForShow(
  tmdbId: number,
  seasons: TvSeason[],
  next: TvAiring | null,
  from: string,
  to: string,
): TvScheduledEpisode[] {
  const inRange = (date: string | null): date is string =>
    !!date && date >= from && date <= to;
  const byKey = new Map<string, TvScheduledEpisode>();
  for (const season of seasons) {
    for (const episode of season.episodes) {
      if (!inRange(episode.airDate)) continue;
      byKey.set(`${episode.seasonNumber}:${episode.episodeNumber}`, {
        tmdbId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        name: episode.name,
        airDate: episode.airDate,
        stillPath: episode.stillPath,
      });
    }
  }
  if (next && inRange(next.airDate)) {
    const key = `${next.seasonNumber}:${next.episodeNumber}`;
    if (!byKey.has(key)) byKey.set(key, { tmdbId, ...next });
  }
  return [...byKey.values()];
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(value: string | undefined): value is string {
  return value !== undefined && ISO_DAY.test(value);
}
