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

/** All statuses a library item can carry — media-neutral canonical terms.
 *  Per-media display wording (e.g. active → "Playing"/"Watching"/"Reading")
 *  and which subset a media type exposes live client-side. */
export const ITEM_STATUSES = [
  "wishlisted",
  "backlogged",
  "active",
  "paused",
  "dropped",
  "finished",
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
  active: "in-progress",
  paused: "in-progress",
  dropped: "finished",
  finished: "finished",
  completed: "finished",
};

/** Statuses whose meta group is not "finished" — the Library grid queries
 *  for exactly this set (index-backed on `status`) so it never has to load
 *  or filter out the finished majority client-side. */
export const NON_FINISHED_STATUSES: readonly ItemStatus[] =
  ITEM_STATUSES.filter((s) => STATUS_META_GROUP[s] !== "finished");

/** The kinds of media a library item can track. */
export const MEDIA_TYPES = ["game", "movie", "tv", "book"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** Progress log formats. Append new units here; adding one never bumps the
 *  RxDB schema (progressFormat is a plain string there, mirroring `status`). */
export const LOG_FORMATS = ["percent", "hours", "pages"] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

/** Allowed manual log formats per media type; the FIRST entry is the default
 *  for a new item of that type. Empty means the media type has no manual
 *  progress log: movies are binary watched/unwatched, and TV progress is
 *  derived from `watchedEpisodes`. */
export const LOG_FORMATS_BY_MEDIA: Record<MediaType, readonly LogFormat[]> = {
  game: ["hours", "percent"],
  movie: [],
  tv: [],
  book: ["pages", "percent", "hours"],
};

/** Default log format for a newly added item of the given media type.
 *  Media types without a manual log fall back to an inert "percent". */
export function defaultLogFormat(mediaType: MediaType): LogFormat {
  return LOG_FORMATS_BY_MEDIA[mediaType][0] ?? "percent";
}

/** Canonical watched-episode key for `LibraryItem.watchedEpisodes`, e.g.
 *  episodeKey(1, 3) === "s1e3". Season 0 is TMDB's "Specials" convention. */
export function episodeKey(season: number, episode: number): string {
  return `s${season}e${episode}`;
}

/** Inverse of {@link episodeKey}: "s1e3" → { season: 1, episode: 3 }.
 *  Returns { season: 0, episode: 0 } for a malformed key. */
export function parseEpisodeKey(key: string): {
  season: number;
  episode: number;
} {
  const m = /^s(\d+)e(\d+)$/.exec(key);
  return m
    ? { season: Number(m[1]), episode: Number(m[2]) }
    : { season: 0, episode: 0 };
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
  /** TV only: episode key (see {@link episodeKey}) → local `YYYY-MM-DD`
   *  watch date (`""` = date unknown, from pre-v6 migration). `{}` for other
   *  media types. */
  watchedEpisodes: Record<string, string>;
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
