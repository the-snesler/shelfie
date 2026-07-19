/**
 * HTTP-only types for the books metadata endpoints, mirroring the game
 * card/detail split. Backed by Goodreads (autocomplete JSON + internal
 * GraphQL, Grimmory-style); never synced. The stable key is Goodreads'
 * legacy numeric BOOK id (the number in /book/show/{id}-{slug}); it drives
 * the client's /books/<id> route. Covers are full CDN URLs (gr-assets),
 * loaded directly by the client — no image proxy.
 */

/** A single row from `GET /api/books/search?q=`. */
export interface BookSearchResult {
  goodreadsId: number;
  name: string;
  authors: string[];
  year: number | null;
  coverUrl: string | null;
  pageCount: number | null;
}

/** Card tier: `GET /api/books?ids=`, backed by the server's `book_metadata` table. */
export interface BookMetadata {
  goodreadsId: number;
  name: string;
  coverUrl: string | null;
  authors: string[];
  year: number | null;
  /** Needed client-side to derive % from a "pages" progress log. */
  pageCount: number | null;
}

export interface BookSeries {
  name: string;
  /** Position within the series as Goodreads reports it (may be "1.5"). */
  position: string | null;
}

/** Heavy, on-demand projection served by GET /api/books/by-id/:id. Never synced. */
export interface BookDetail extends BookMetadata {
  description: string | null;
  publisher: string | null;
  /** ISO "YYYY-MM-DD"; null when unknown. */
  publicationDate: string | null;
  isbn13: string | null;
  series: BookSeries | null;
  genres: string[];
  /** Goodreads community average, 0–5. */
  avgRating: number | null;
  ratingsCount: number | null;
  language: string | null;
}
