/**
 * HTTP-only types for the games metadata endpoints. Unlike {@link
 * LibraryItem}, these never travel through RxDB replication — the server
 * fetches and caches them from IGDB, and the client fetches them over plain
 * HTTP (`GET /api/games/search`, `GET /api/games`).
 */

/** A single row from `GET /api/games/search?q=`. */
export interface SearchResult {
  igdbId: number;
  name: string;
  coverUrl: string | null;
  year: number | null;
  platforms: string[];
}

/** A single row from `GET /api/games?ids=`, backed by the server's `game_metadata` cache table. */
export interface GameMetadata {
  igdbId: number;
  name: string;
  coverImageId: string | null;
  summary: string | null;
  genres: string[];
  platforms: string[];
  developer: string | null;
  /** epoch seconds */
  firstReleaseDate: number | null;
}
