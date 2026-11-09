/** Server-owned source connections; credentials never enter library replication. */
export const IMPORT_SOURCES = ["trakt", "bookorbit", "steam"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

export interface ImportConnection {
  source: ImportSource;
  enabled: boolean;
  /** Five-field UTC cron expression; empty disables periodic imports. */
  schedule: string;
  account: string;
  baseUrl: string;
  hasApiKey: boolean;
  hasAccessToken: boolean;
  running: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  lastResult: ImportResult | null;
}

export interface ImportConnectionInput {
  enabled: boolean;
  schedule: string;
  account: string;
  baseUrl: string;
  /** Omit to preserve the saved credential; empty string clears it. */
  apiKey?: string;
  accessToken?: string;
}

/** Sources whose books are matched to Goodreads IDs by Shelfie. */
export const BOOK_LINK_SOURCES = [
  "bookorbit",
] as const satisfies readonly ImportSource[];
export type BookLinkSource = (typeof BOOK_LINK_SOURCES)[number];

/**
 * How a source book reached its Goodreads ID. `manual` and `ignored` are user
 * choices that imports never revisit; `none` means automatic matching found
 * nothing and will retry later.
 */
export type BookLinkMethod =
  "manual" | "ignored" | "library" | "title" | "isbn" | "none";

export interface ImportBookLink {
  /** The source's own book ID, e.g. BookOrbit's numeric book id. */
  externalId: string;
  title: string;
  authors: string[];
  /** Goodreads legacy book id; null when unmatched or ignored. */
  goodreadsId: number | null;
  method: BookLinkMethod;
  checkedAt: number;
}

/** `null` marks the book as not on Goodreads, so imports skip it quietly. */
export interface ImportBookLinkInput {
  goodreadsId: number | null;
}
