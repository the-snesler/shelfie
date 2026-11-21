import type { ItemStatus, MediaType } from "./types.js";

/** Server-owned source connections; credentials never enter library replication. */
export const IMPORT_SOURCES = ["trakt", "bookorbit", "steam"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/**
 * Coarse groups of source entries an import policy toggles, derived from the
 * status an entry maps to (`importBucket`), so adapters never label them.
 */
export const IMPORT_BUCKETS = [
  "completed",
  "inProgress",
  "backlog",
  "wishlist",
  "dropped",
] as const;
export type ImportBucket = (typeof IMPORT_BUCKETS)[number];

const BUCKET_BY_STATUS: Record<ItemStatus, ImportBucket> = {
  finished: "completed",
  completed: "completed",
  active: "inProgress",
  paused: "inProgress",
  backlogged: "backlog",
  wishlisted: "wishlist",
  dropped: "dropped",
};

export function importBucket(status: ItemStatus): ImportBucket {
  return BUCKET_BY_STATUS[status];
}

/** What a source can report: buckets it never produces are not offered. */
export interface ImportSourceCapabilities {
  buckets: readonly ImportBucket[];
  mediaTypes: readonly MediaType[];
}

export const IMPORT_SOURCE_CAPABILITIES: Record<
  ImportSource,
  ImportSourceCapabilities
> = {
  // Playtime never implies completion, and the owned-games list has no wishlist.
  steam: { buckets: ["inProgress", "backlog"], mediaTypes: ["game"] },
  // Movies and TV plan with the watchlist ("backlogged"); shows import as
  // in progress and the TV progress check marks finished seasons afterwards.
  trakt: {
    buckets: ["completed", "inProgress", "backlog"],
    mediaTypes: ["movie", "tv"],
  },
  bookorbit: { buckets: IMPORT_BUCKETS, mediaTypes: ["book"] },
};

/**
 * Which source entries an import considers, and what it may do with them.
 * One global default applies to every source unless a source saves its own.
 */
export interface ImportPolicy {
  /** Entries in a disabled bucket are ignored entirely: never added or updated. */
  buckets: Record<ImportBucket, boolean>;
  /** Add entries that are not in the library yet. */
  addNew: boolean;
  /** Merge ratings, dates, episodes and progress into items already in the library. */
  updateExisting: boolean;
  /**
   * With `updateExisting`, also move an existing item's status forward when
   * its status in the source changes. Off, imports only set a new item's
   * initial status.
   */
  updateStatuses: boolean;
  /** ISO day; entries whose latest activity is earlier are ignored. Undated entries always pass. */
  since: string | null;
  /** Media types to import, for sources that report more than one. */
  mediaTypes: MediaType[];
}

export const DEFAULT_IMPORT_POLICY: ImportPolicy = {
  buckets: {
    completed: true,
    inProgress: true,
    backlog: false,
    wishlist: false,
    dropped: false,
  },
  addNew: true,
  updateExisting: true,
  updateStatuses: true,
  since: null,
  mediaTypes: ["game", "movie", "tv", "book"],
};

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  /** Entries the policy left out. Absent from results stored before policies existed. */
  filtered?: number;
  warnings: string[];
}

export interface ImportPreviewGroup {
  count: number;
  /** A few titles, for a tooltip. */
  samples: string[];
}

/** What an import would do with the current policy, computed without writing. */
export interface ImportPreview {
  at: number;
  added: Partial<Record<ImportBucket, ImportPreviewGroup>>;
  updated: Partial<Record<ImportBucket, ImportPreviewGroup>>;
  filtered: number;
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
  /** This source's own policy; null follows the import defaults. */
  policy: ImportPolicy | null;
  running: boolean;
  previewing: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  lastResult: ImportResult | null;
  /** Cleared whenever the connection or the defaults change. */
  lastPreview: ImportPreview | null;
}

export interface ImportConnectionInput {
  enabled: boolean;
  schedule: string;
  account: string;
  baseUrl: string;
  /** Omit to preserve the saved credential; empty string clears it. */
  apiKey?: string;
  accessToken?: string;
  /** Omit to keep the saved policy; null follows the import defaults. */
  policy?: ImportPolicy | null;
}

/** Sources whose books are matched to Goodreads IDs by Shelfie. */
export const BOOK_LINK_SOURCES = [
  "bookorbit",
] as const satisfies readonly ImportSource[];
export type BookLinkSource = (typeof BOOK_LINK_SOURCES)[number];

/**
 * How a source book reached its Goodreads ID. `manual` and `ignored` are user
 * choices that imports never revisit; `source` is the source's own Goodreads
 * ID, mapped to the work's best edition; `none` means automatic matching
 * found nothing and will retry later.
 */
export type BookLinkMethod =
  "manual" | "ignored" | "library" | "source" | "title" | "isbn" | "none";

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
