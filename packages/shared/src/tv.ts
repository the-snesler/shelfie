/**
 * HTTP-only types for the TV metadata endpoints, mirroring the game
 * card/detail split. Backed by TMDB; never synced. The numeric TMDB id is
 * the stable key (drives /tv/<id>). Episode-level watched state lives on the
 * synced LibraryItem (`watchedEpisodes`), NOT here — this is the server-owned
 * catalog of what episodes exist.
 */
import type { CastMember, MediaVideo } from "./movies.js";

/** A single row from `GET /api/tv/search?q=`. */
export interface TvSearchResult {
  tmdbId: number;
  name: string;
  year: number | null;
  posterPath: string | null;
}

/** Card tier: `GET /api/tv?ids=`, backed by the server's `tv_metadata` table. */
export interface TvMetadata {
  tmdbId: number;
  name: string;
  posterPath: string | null;
  genres: string[];
  firstAirYear: number | null;
  /** ISO "YYYY-MM-DD" of the first aired episode; null when TMDB has none
   *  yet. Drives the library's Unreleased split. */
  firstAirDate: string | null;
  /** TMDB series status, e.g. "Returning Series" | "Ended" | "Canceled". */
  status: string | null;
  /** Excludes season 0 (Specials), matching TMDB's convention. */
  numberOfSeasons: number;
  /** Excludes specials; the denominator for derived watch progress. */
  numberOfEpisodes: number;
  networks: string[];
  createdBy: string[];
  summary: string | null;
  /** TMDB's `next_episode_to_air`; null when nothing is scheduled (or the
   *  show has ended). Card-tier so the library can say "airs Fri" offline. */
  nextEpisodeToAir: TvAiring | null;
  /** TMDB's `last_episode_to_air`; null when nothing has aired. Its
   *  `episodeType` tells a season finale apart (see `tvWatchState`). */
  lastEpisodeToAir: TvLastAiring | null;
  /** Regular (non-special) episodes aired through `lastEpisodeToAir`.
   *  Unlike `numberOfEpisodes`, excludes announced-but-unaired episodes, so
   *  it is what "caught up" is measured against. Null when unknown. */
  airedEpisodes: number | null;
}

/** The latest aired episode, with TMDB's `episode_type`. */
export interface TvLastAiring extends TvAiring {
  /** "standard" | "mid_season" | "finale"; null when TMDB doesn't say. */
  episodeType: string | null;
}

/** One dated, upcoming-or-recent episode airing. */
export interface TvAiring {
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  /** ISO "YYYY-MM-DD". */
  airDate: string;
  stillPath: string | null;
}

/** A single row from `GET /api/tv/schedule?ids=&from=&to=`. */
export interface TvScheduledEpisode extends TvAiring {
  tmdbId: number;
}

export interface TvEpisode {
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  /** ISO "YYYY-MM-DD"; null when unscheduled. */
  airDate: string | null;
  /** minutes */
  runtime: number | null;
  stillPath: string | null;
}

export interface TvSeason {
  /** 0 = Specials. */
  seasonNumber: number;
  name: string;
  airDate: string | null;
  posterPath: string | null;
  episodes: TvEpisode[];
}

/** Heavy, on-demand projection served by GET /api/tv/by-id/:id. Never synced. */
export interface TvDetail extends TvMetadata {
  backdropPath: string | null;
  tagline: string | null;
  /** US content rating (e.g. "TV-MA"); null when unknown. */
  certification: string | null;
  voteAverage: number | null;
  voteCount: number;
  videos: MediaVideo[];
  /** From aggregate_credits (full-series cast); capped server-side (~20). */
  cast: CastMember[];
  /** All seasons in ascending seasonNumber, including Specials when present. */
  seasons: TvSeason[];
  lastAirDate: string | null;
  inProduction: boolean;
  imdbId: string | null;
}
