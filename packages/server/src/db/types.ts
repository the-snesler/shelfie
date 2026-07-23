/**
 * Kysely table interfaces. Column names are snake_case to keep the SQL in the
 * common SQLite/Postgres subset; the sync layer maps to/from the camelCase
 * LibraryItem contract in sync/row.ts.
 */

/** Synced library item — contract fields + server-owned replication cursor. */
export interface LibraryItemsTable {
  id: string;
  media_type: string;
  source_id: string;
  status: string;
  /** Log format for progress_value; one of the media type's LOG_FORMATS. */
  progress_format: string;
  /** Progress amount in progress_format's unit; NULL until logged. */
  progress_value: number | null;
  added_at: number;
  updated_at: number;
  /** JSON-encoded string[] — IGDB platform names the user owns this on. */
  platforms: string;
  /** Half-star rating 0.5–5; NULL when unrated. */
  rating: number | null;
  /** JSON-encoded string[] of ISO YYYY-MM-DD completion dates. */
  completed_dates: string;
  /** Free-text notes; empty string when none. */
  notes: string;
  /** JSON-encoded Record<episodeKey, YYYY-MM-DD watch date> (e.g.
   *  {"s1e3":"2024-06-01"}); "{}" for non-TV items. */
  watched_episodes: string;
  /** server-owned replication cursor */
  seq: number;
  /** 0 | 1 — SQLite has no native boolean */
  deleted: number;
}

/**
 * Server-only IGDB metadata cache. Never part of the RxDB sync protocol —
 * populated lazily by the games API from IGDB responses.
 */
export interface GameMetadataTable {
  igdb_id: number;
  /** IGDB's unique URL slug; null for rows cached before migration 002. */
  slug: string | null;
  name: string;
  cover_image_id: string | null;
  summary: string | null;
  /** JSON-encoded string[] */
  genres: string;
  /** JSON-encoded string[] */
  platforms: string;
  /** JSON-encoded PlatformRelease[] — earliest release date per platform. */
  platform_release_dates: string;
  developer: string | null;
  /** epoch seconds */
  first_release_date: number | null;
  /** epoch ms — when this row was last (re)fetched from IGDB */
  fetched_at: number;
  storyline: string | null;
  /** JSON-encoded string[] */
  screenshots: string | null;
  /** JSON-encoded GameVideo[] */
  videos: string | null;
  /** JSON-encoded string[] */
  game_modes: string | null;
  /** JSON-encoded string[] */
  themes: string | null;
  /** JSON-encoded string[] */
  player_perspectives: string | null;
  publisher: string | null;
  aggregated_rating: number | null;
  aggregated_rating_count: number | null;
  rating: number | null;
  rating_count: number | null;
  /** JSON-encoded StoreLink[] */
  stores: string | null;
  /** JSON-encoded TimeToBeat */
  time_to_beat: string | null;
  /** epoch ms — NULL means the detail tier has never been fetched */
  detail_fetched_at: number | null;
}

/**
 * Server-only TMDB movie metadata cache. Never synced — populated lazily by
 * the movies API. Card columns are always set; detail columns stay NULL
 * until the first detail fetch (`detail_fetched_at`).
 */
export interface MovieMetadataTable {
  tmdb_id: number;
  name: string;
  /** bare TMDB image path, e.g. "/gDzOcq0.jpg" */
  poster_path: string | null;
  /** JSON-encoded string[] */
  genres: string;
  year: number | null;
  director: string | null;
  /** minutes */
  runtime: number | null;
  summary: string | null;
  backdrop_path: string | null;
  tagline: string | null;
  certification: string | null;
  vote_average: number | null;
  vote_count: number | null;
  /** JSON-encoded MediaVideo[] */
  videos: string | null;
  /** JSON-encoded CastMember[] ("cast" is a SQL keyword) */
  cast_members: string | null;
  imdb_id: string | null;
  /** epoch ms — when the card tier was last (re)fetched from TMDB */
  fetched_at: number;
  /** epoch ms — NULL means the detail tier has never been fetched */
  detail_fetched_at: number | null;
}

/** Server-only TMDB TV metadata cache; same card/detail split as movies. */
export interface TvMetadataTable {
  tmdb_id: number;
  name: string;
  poster_path: string | null;
  /** JSON-encoded string[] */
  genres: string;
  first_air_year: number | null;
  /** TMDB series status, e.g. "Returning Series" | "Ended" */
  status: string | null;
  /** excludes season 0 (Specials) */
  number_of_seasons: number;
  /** excludes specials; denominator for derived watch progress */
  number_of_episodes: number;
  /** JSON-encoded string[] */
  networks: string;
  /** JSON-encoded string[] */
  created_by: string;
  summary: string | null;
  backdrop_path: string | null;
  tagline: string | null;
  /** US content rating, e.g. "TV-MA" */
  certification: string | null;
  vote_average: number | null;
  vote_count: number | null;
  /** JSON-encoded MediaVideo[] */
  videos: string | null;
  /** JSON-encoded CastMember[] */
  cast_members: string | null;
  /** JSON-encoded TvSeason[] incl. episodes; the episode catalog */
  seasons: string | null;
  /** ISO YYYY-MM-DD */
  last_air_date: string | null;
  /** 0 | 1 — SQLite has no native boolean */
  in_production: number | null;
  imdb_id: string | null;
  fetched_at: number;
  detail_fetched_at: number | null;
}

/** Server-only Goodreads book metadata cache; same card/detail split. */
export interface BookMetadataTable {
  /** Goodreads legacy numeric book id (from /book/show/{id}-{slug}). */
  goodreads_id: number;
  name: string;
  /** full gr-assets CDN URL; loaded directly by the client */
  cover_url: string | null;
  /** JSON-encoded string[] */
  authors: string;
  year: number | null;
  page_count: number | null;
  description: string | null;
  publisher: string | null;
  /** ISO YYYY-MM-DD */
  publication_date: string | null;
  isbn13: string | null;
  series_name: string | null;
  /** Goodreads series position; may be fractional like "1.5" */
  series_position: string | null;
  /** JSON-encoded string[] */
  genres: string | null;
  /** Goodreads community average, 0–5 */
  avg_rating: number | null;
  ratings_count: number | null;
  language: string | null;
  fetched_at: number;
  detail_fetched_at: number | null;
}

/** Single-user password record. Exactly one row is expected, keyed by "owner". */
export interface AuthOwnerTable {
  id: string;
  password_hash: string;
  created_at: number;
  updated_at: number;
}

/**
 * Server-side sessions. The browser only sees the random token; SQLite stores
 * the sha256 hash so a database dump does not contain live bearer tokens.
 */
export interface AuthSessionsTable {
  id: string;
  token_hash: string;
  created_at: number;
  last_seen_at: number;
  user_agent: string | null;
  revoked_at: number | null;
}

/** Versioned migration bookkeeping — one row per applied migration. */
export interface MigrationsTable {
  id: number;
  name: string;
  applied_at: number;
}

export interface Database {
  library_items: LibraryItemsTable;
  game_metadata: GameMetadataTable;
  movie_metadata: MovieMetadataTable;
  tv_metadata: TvMetadataTable;
  book_metadata: BookMetadataTable;
  auth_owner: AuthOwnerTable;
  auth_sessions: AuthSessionsTable;
  migrations: MigrationsTable;
}
