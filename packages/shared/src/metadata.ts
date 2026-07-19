/**
 * HTTP-only types for the games metadata endpoints. Unlike {@link
 * LibraryItem}, these never travel through RxDB replication — the server
 * fetches and caches them from IGDB, and the client fetches them over plain
 * HTTP (`GET /api/games/search`, `GET /api/games`).
 */

/** A single row from `GET /api/games/search?q=`. */
export interface SearchResult {
  igdbId: number;
  /** IGDB's unique URL slug, e.g. "hades--1"; drives the client's /games/<slug> route. */
  slug: string;
  name: string;
  coverUrl: string | null;
  year: number | null;
  platforms: string[];
}

/** Earliest known release date for one platform of a game. */
export interface PlatformRelease {
  platform: string; // IGDB platform name, matches an entry in `platforms`
  date: number; // epoch seconds
}

/** A single row from `GET /api/games?ids=`, backed by the server's `game_metadata` cache table. */
export interface GameMetadata {
  igdbId: number;
  /** IGDB's unique URL slug, e.g. "hades--1"; drives the client's /games/<slug> route. */
  slug: string;
  name: string;
  coverImageId: string | null;
  summary: string | null;
  genres: string[];
  platforms: string[];
  /** Earliest known release date per platform, ascending by date. Drives
   *  default cover-platform selection ("released on first"). May be empty. */
  platformReleaseDates: PlatformRelease[];
  developer: string | null;
  /** epoch seconds */
  firstReleaseDate: number | null;
  /** IGDB average completion times; null when IGDB has none. Card-tier so the
   *  library grid can show "hours left" offline. */
  timeToBeat: TimeToBeat | null;
}

export interface GameVideo {
  videoId: string; // YouTube id
  name: string | null;
}

export type StoreName = "official" | "steam" | "epic" | "gog" | "itch";

export interface StoreLink {
  store: StoreName;
  url: string;
}

/** Average completion times in SECONDS; null when IGDB has no value. */
export interface TimeToBeat {
  hastily: number | null;
  normally: number | null;
  completely: number | null;
  count: number; // submissions backing the averages
}

/** Heavy, on-demand projection served by GET /api/games/by-slug/:slug. Never synced. */
export interface GameDetail extends GameMetadata {
  storyline: string | null;
  screenshotImageIds: string[];
  videos: GameVideo[];
  gameModes: string[];
  themes: string[];
  playerPerspectives: string[];
  publisher: string | null;
  aggregatedRating: number | null; // 0-100 external critic aggregate; null when unrated
  aggregatedRatingCount: number;
  rating: number | null; // 0-100 IGDB user rating; null when unrated
  ratingCount: number;
  stores: StoreLink[];
  timeToBeat: TimeToBeat | null;
}
