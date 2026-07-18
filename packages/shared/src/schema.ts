import type { MigrationStrategies, RxJsonSchema } from "rxdb";
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
  version: 2,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 64 },
    mediaType: { type: "string", maxLength: 16 },
    sourceId: { type: "string", maxLength: 64 },
    status: { type: "string", maxLength: 16 },
    progress: {
      type: ["number", "null"],
      minimum: 0,
      maximum: 100,
      multipleOf: 1,
    },
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
    completedDates: {
      type: "array",
      items: { type: "string", maxLength: 10 },
      maxItems: 100,
    },
    notes: { type: "string", maxLength: 10000 },
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
    "progress",
    "platforms",
    "rating",
    "completedDates",
    "notes",
    "addedAt",
    "updatedAt",
  ],
  indexes: ["updatedAt"],
} as const;

/**
 * Migration seam for `library_items`. Schema version 1 adds `platforms`;
 * existing documents default to an empty list. Version 2 adds `rating`,
 * `completedDates`, and `notes`.
 */
export const libraryItemMigrationStrategies: MigrationStrategies = {
  1: (oldDoc) => ({ ...oldDoc, platforms: [] }),
  2: (oldDoc) => ({ ...oldDoc, rating: null, completedDates: [], notes: "" }),
};
