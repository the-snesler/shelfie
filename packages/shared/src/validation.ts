import { z } from "zod";
import { ITEM_STATUSES, LOG_FORMATS, MEDIA_TYPES } from "./types.js";
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
  mediaType: z.enum(MEDIA_TYPES),
  sourceId: z.string().min(1).max(64),
  status: z.enum(ITEM_STATUSES),
  // Only meaningful for in-progress statuses, but always present (never
  // absent) so the RxDB schema's `required` list stays simple.
  progressFormat: z.enum(LOG_FORMATS),
  progressValue: z.number().min(0).nullable(),
  addedAt: z.number().positive(),
  updatedAt: z.number().positive(),
  platforms: z.array(z.string().min(1).max(64)).max(32),
  rating: z.number().min(0.5).max(5).multipleOf(0.5).nullable(),
  completedDates: z
    .array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/))
    .max(100),
  notes: z.string().max(10000),
  // TV episode keys ("s<season>e<episode>", see episodeKey()) → local
  // YYYY-MM-DD watch date ("" = unknown); {} for every other media type.
  watchedEpisodes: z
    .record(z.string(), z.string())
    .refine(
      (r) =>
        Object.keys(r).length <= 10000 &&
        Object.entries(r).every(
          ([k, v]) =>
            /^s\d{1,3}e\d{1,4}$/.test(k) &&
            (v === "" ||
              /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)),
        ),
      { message: "invalid watchedEpisodes" },
    ),
  _deleted: z.boolean(),
});
