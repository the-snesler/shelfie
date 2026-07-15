import { z } from "zod";
import { ITEM_STATUSES } from "./types.js";
import type { ReplicatedLibraryItem } from "./types.js";

/**
 * Zod mirror of {@link ReplicatedLibraryItem} (document fields + `_deleted`).
 * The server validates every document it receives at the push boundary
 * against this before writing to SQLite — the runtime guard against
 * client/server drift.
 */
export const libraryItemDocSchema: z.ZodType<ReplicatedLibraryItem> = z.object({
  // Mediatype-prefixed id, e.g. "game:1942" — kept in lockstep with
  // `${mediaType}:${sourceId}` construction on write.
  id: z.string().regex(/^[a-z]+:\d+$/),
  mediaType: z.literal("game"),
  sourceId: z.string().min(1).max(64),
  status: z.enum(ITEM_STATUSES),
  // Only meaningful when status === "playing", but always present (never
  // absent) so the RxDB schema's `required` list stays simple.
  progress: z.number().int().min(0).max(100).nullable(),
  addedAt: z.number().positive(),
  updatedAt: z.number().positive(),
  _deleted: z.boolean(),
});
