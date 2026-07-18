/**
 * The single source of truth for a library item's shape. Both the client
 * (RxDB collection) and the server (sync handlers) import this. If these
 * drift, sync corrupts silently — so the schema and validator are derived
 * from the same intent and kept in lockstep.
 *
 * Note the split: RxDB owns the `_deleted` soft-delete flag, so the
 * *document* type and JSON schema must NOT include it. It only appears on
 * the wire during replication, captured by {@link ReplicatedLibraryItem}.
 */

/** All statuses a library item can carry. */
export const ITEM_STATUSES = [
  "wishlisted",
  "backlogged",
  "playing",
  "played",
  "beaten",
  "completed",
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Coarse buckets the library home groups items into, independent of media
 *  type. Array order is display order. */
export const META_STATUSES = ["in-progress", "planned", "finished"] as const;
export type MetaStatus = (typeof META_STATUSES)[number];

/** Every item status → its bucket. Keyed by ItemStatus so adding a status is
 *  a compile error until it is bucketed here. */
export const STATUS_META_GROUP: Record<ItemStatus, MetaStatus> = {
  wishlisted: "planned",
  backlogged: "planned",
  playing: "in-progress",
  played: "finished",
  beaten: "finished",
  completed: "finished",
};

/** The kind of media a library item tracks. Union will grow (movies, books, …). */
export type MediaType = "game";

/** Progress log formats. Append new units (e.g. "pages", "episodes", "minutes")
 *  here; adding one never bumps the RxDB schema (progressFormat is a plain
 *  string there, mirroring `status`). */
export const LOG_FORMATS = ["percent", "hours"] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

/** Allowed formats per media type; the FIRST entry is the default for a new
 *  item of that type. Grows as media types and formats are added. */
export const LOG_FORMATS_BY_MEDIA: Record<MediaType, readonly LogFormat[]> = {
  game: ["hours", "percent"],
};

/** Default log format for a newly added item of the given media type. */
export function defaultLogFormat(mediaType: MediaType): LogFormat {
  return LOG_FORMATS_BY_MEDIA[mediaType][0];
}

export interface LibraryItem {
  /** `${mediaType}:${sourceId}`, e.g. "game:1942" */
  id: string;
  mediaType: MediaType;
  /** id in the source catalog (e.g. IGDB game id), stringified */
  sourceId: string;
  status: ItemStatus;
  /** How progressValue is expressed; one of this media type's LOG_FORMATS. */
  progressFormat: LogFormat;
  /** Progress amount in progressFormat's unit (percent 0–100 int, or hours ≥0,
   *  fractional allowed); null until the user logs progress. */
  progressValue: number | null;
  /** IGDB platform names the user owns this game on; the first entry drives
   *  cover rendering. Empty until the user records one. */
  platforms: string[];
  /** Half-star rating, 0.5–5 in 0.5 steps; null when unrated. */
  rating: number | null;
  /** Calendar days (ISO "YYYY-MM-DD") the user marked this finished.
   *  Empty until the first completion. Display order is a UI concern. */
  completedDates: string[];
  /** Free-text notes; empty string when none. */
  notes: string;
  /** ms epoch */
  addedAt: number;
  /** ms epoch — last-write-time; used by conflict resolution and UI sorting */
  updatedAt: number;
}

/** A library item as it travels over the sync protocol, carrying RxDB's soft-delete flag. */
export type ReplicatedLibraryItem = LibraryItem & { _deleted: boolean };

/**
 * Replication checkpoint. The server owns `seq` and uses it as the pull
 * cursor, so sync ordering does not depend on client clocks. Each collection
 * tracks its own checkpoint.
 */
export interface Checkpoint {
  seq: number;
}
