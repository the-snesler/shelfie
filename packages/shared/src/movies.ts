/**
 * HTTP-only types for the movies metadata endpoints, mirroring the game
 * card/detail split in metadata.ts. Backed by TMDB; never synced through
 * RxDB. TMDB has no slugs — the numeric TMDB id is the stable key and drives
 * the client's /movies/<id> route. Image fields hold bare TMDB paths (e.g.
 * "/gDzOcq0.jpg"); the client composes the CDN URL with a size bucket.
 */

/** A single row from `GET /api/movies/search?q=`. */
export interface MovieSearchResult {
  tmdbId: number;
  name: string;
  year: number | null;
  posterPath: string | null;
}

/** A YouTube video attached to a movie or TV show. */
export interface MediaVideo {
  videoId: string; // YouTube id (TMDB `key`)
  name: string | null;
}

/** One cast credit, movie or TV. */
export interface CastMember {
  name: string;
  character: string | null;
  profilePath: string | null;
}

/** Card tier: `GET /api/movies?ids=`, backed by the server's `movie_metadata` table. */
export interface MovieMetadata {
  tmdbId: number;
  name: string;
  posterPath: string | null;
  genres: string[];
  year: number | null;
  director: string | null;
  /** minutes; null/0 when TMDB has none */
  runtime: number | null;
  summary: string | null;
}

/** Heavy, on-demand projection served by GET /api/movies/by-id/:id. Never synced. */
export interface MovieDetail extends MovieMetadata {
  backdropPath: string | null;
  tagline: string | null;
  /** US certification (e.g. "PG-13"); null when unknown. */
  certification: string | null;
  /** 0–10 TMDB user score; null when unrated. */
  voteAverage: number | null;
  voteCount: number;
  videos: MediaVideo[];
  /** Ordered by TMDB billing; capped server-side (~20). */
  cast: CastMember[];
  imdbId: string | null;
}
