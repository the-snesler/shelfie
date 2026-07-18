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

export interface LibraryItem {
  /** `${mediaType}:${sourceId}`, e.g. "game:1942" */
  id: string;
  mediaType: MediaType;
  /** id in the source catalog (e.g. IGDB game id), stringified */
  sourceId: string;
  status: ItemStatus;
  /** 0-100 int; only meaningful when status === "playing" */
  progress: number | null;
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
