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
  /** TMDB series status, e.g. "Returning Series" | "Ended" | "Canceled". */
  status: string | null;
  /** Excludes season 0 (Specials), matching TMDB's convention. */
  numberOfSeasons: number;
  /** Excludes specials; the denominator for derived watch progress. */
  numberOfEpisodes: number;
  networks: string[];
  createdBy: string[];
  summary: string | null;
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
