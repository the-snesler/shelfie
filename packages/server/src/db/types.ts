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
  auth_owner: AuthOwnerTable;
  auth_sessions: AuthSessionsTable;
  migrations: MigrationsTable;
}
