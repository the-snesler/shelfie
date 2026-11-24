import type { MigrationStrategies, RxJsonSchema } from "rxdb";
import { MOMENT_MAX_LENGTH } from "./moments.js";
import type { LibraryItem } from "./types.js";

/**
 * RxDB JSON schema for the `library_items` collection. The client builds its
 * collection from this. `_deleted` is intentionally absent — RxDB manages the
 * soft-delete field itself. A string primary key must declare `maxLength`.
 *
 * `status` is kept as a plain `string` here (not a JSON-schema `enum`) — the
 * enum is enforced by {@link libraryItemDocSchema} at the push boundary and
 * client-side write sites instead, so adding a status never needs a schema
 * version bump.
 */
export const libraryItemSchema: RxJsonSchema<LibraryItem> = {
  title: "library item schema",
  version: 10,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 64 },
    mediaType: { type: "string", maxLength: 16 },
    sourceId: { type: "string", maxLength: 64 },
    status: { type: "string", maxLength: 16 },
    progressFormat: { type: "string", maxLength: 16 },
    progressValue: { type: ["number", "null"], minimum: 0 },
    platforms: {
      type: "array",
      items: { type: "string", maxLength: 64 },
      maxItems: 32,
    },
    storefront: { type: ["string", "null"], maxLength: 16 },
    rating: {
      type: ["number", "null"],
      minimum: 0.5,
      maximum: 5,
      multipleOf: 0.5,
    },
    excitement: {
      type: ["integer", "null"],
      minimum: 1,
      maximum: 4,
    },
    completions: {
      type: "array",
      items: { type: "string", maxLength: MOMENT_MAX_LENGTH },
      maxItems: 100,
    },
    notes: { type: "string", maxLength: 10000 },
    watchedEpisodes: {
      type: "object",
      additionalProperties: { type: "string", maxLength: MOMENT_MAX_LENGTH },
    },
    activity: {
      type: "array",
      default: [],
      items: {
        type: "object",
        properties: {
          id: { type: "string", maxLength: 64 },
          at: {
            type: "number",
            minimum: 1,
            maximum: 9007199254740991,
            multipleOf: 1,
          },
          changes: {
            type: "object",
            properties: {
              status: { type: "string", maxLength: 16 },
              progressFormat: { type: "string", maxLength: 16 },
              progressValue: { type: ["number", "null"], minimum: 0 },
              platforms: {
                type: "array",
                items: { type: "string", maxLength: 64 },
                maxItems: 32,
              },
              rating: {
                type: ["number", "null"],
                minimum: 0.5,
                maximum: 5,
                multipleOf: 0.5,
              },
              completions: {
                type: "array",
                items: { type: "string", maxLength: MOMENT_MAX_LENGTH },
                maxItems: 100,
              },
              notes: { type: "string", maxLength: 10000 },
              watchedEpisodes: {
                type: "object",
                additionalProperties: {
                  type: ["string", "null"],
                  maxLength: MOMENT_MAX_LENGTH,
                },
              },
            },
            additionalProperties: false,
          },
        },
        required: ["id", "at", "changes"],
        additionalProperties: false,
      },
    },
    addedAt: {
      type: "number",
      minimum: 0,
      maximum: 9007199254740991,
      multipleOf: 1,
    },
    updatedAt: {
      type: "number",
      minimum: 0,
      maximum: 9007199254740991,
      multipleOf: 1,
    },
  },
  required: [
    "id",
    "mediaType",
    "sourceId",
    "status",
    "progressFormat",
    "progressValue",
    "platforms",
    "storefront",
    "rating",
    "excitement",
    "completions",
    "notes",
    "addedAt",
    "updatedAt",
    "watchedEpisodes",
    "activity",
  ],
  indexes: ["updatedAt", "status"],
} as const;

/** Old game-centric status wording → the media-neutral canonical terms
 *  introduced with multi-media support (schema v4). Mirrored by server
 *  migration 8, which remaps the SQLite rows identically. */
const LEGACY_STATUS_MAP: Record<string, string> = {
  playing: "active",
  played: "dropped",
  beaten: "finished",
};

/**
 * Migration seam for `library_items`. Schema version 1 adds `platforms`;
 * existing documents default to an empty list. Version 2 adds `rating`,
 * `completedDates`, and `notes`. Version 3 splits `progress` into
 * `progressFormat` + `progressValue` (percent data preserved as-is).
 * Version 4 renames game-centric statuses to media-neutral terms and adds
 * `watchedEpisodes`. Version 5 adds an index on `status` (Library grid
 * excludes finished items via an index-backed query) — no document shape
 * change, so the migration is the identity function. Version 6 converts
 * `watchedEpisodes` from a key array to a key→date map (existing keys get
 * empty-string dates). Version 7 adds timestamped activity history.
 * Version 8 adds `excitement` (unset for every existing document).
 * Version 9 adds `storefront` (unset for every existing document).
 * Version 10 renames `completedDates` to `completions` (in activity entries
 * too) now that entries may be instants as well as days (see moments.ts);
 * existing values are bare days, already valid moments, so they carry over
 * unchanged. Mirrored by server migration 27.
 */
export const libraryItemMigrationStrategies: MigrationStrategies = {
  1: (oldDoc) => ({ ...oldDoc, platforms: [] }),
  2: (oldDoc) => ({ ...oldDoc, rating: null, completedDates: [], notes: "" }),
  3: (oldDoc) => {
    const { progress, ...rest } = oldDoc;
    return {
      ...rest,
      progressFormat: "percent",
      progressValue: progress ?? null,
    };
  },
  4: (oldDoc) => ({
    ...oldDoc,
    status: LEGACY_STATUS_MAP[oldDoc.status] ?? oldDoc.status,
    watchedEpisodes: [],
  }),
  5: (oldDoc) => oldDoc,
  6: (oldDoc) => ({
    ...oldDoc,
    watchedEpisodes: Object.fromEntries(
      ((oldDoc.watchedEpisodes as string[] | undefined) ?? []).map((k) => [
        k,
        "",
      ]),
    ),
  }),
  7: (oldDoc) => ({ ...oldDoc, activity: [] }),
  8: (oldDoc) => ({ ...oldDoc, excitement: null }),
  9: (oldDoc) => ({ ...oldDoc, storefront: null }),
  10: (oldDoc) => renameCompletedDates(oldDoc),
};

/**
 * `completedDates` → `completions`, on the item and in every activity entry.
 * Shared with server migration 27 so both sides produce identical documents.
 */
export function renameCompletedDates<
  T extends { completedDates?: unknown; activity?: unknown },
>(doc: T): Omit<T, "completedDates"> & { completions: unknown } {
  const { completedDates, ...rest } = doc;
  const activity = Array.isArray(doc.activity)
    ? doc.activity.map((event: { changes?: Record<string, unknown> }) => {
        if (!event.changes || !("completedDates" in event.changes))
          return event;
        const { completedDates: dates, ...changes } = event.changes;
        return { ...event, changes: { ...changes, completions: dates } };
      })
    : doc.activity;
  return {
    ...rest,
    completions: completedDates ?? [],
    ...(activity === undefined ? {} : { activity }),
  };
}
