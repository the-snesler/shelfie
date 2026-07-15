import type { RxJsonSchema } from "rxdb";
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
  version: 0,
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
    addedAt: {
      type: "number",
      minimum: 0,
      maximum: 9007199254740991,
      multipleOf: 1,
    },
    updatedAt: { type: "number" },
  },
  required: [
    "id",
    "mediaType",
    "sourceId",
    "status",
    "progress",
    "addedAt",
    "updatedAt",
  ],
  indexes: ["updatedAt"],
} as const;

/**
 * Migration seam for `library_items`. Empty because the collection starts at
 * schema version 0 — future field changes bump `version` above and add a
 * numbered strategy here, mirroring aside's per-collection migration maps.
 */
export const libraryItemMigrationStrategies = {};
