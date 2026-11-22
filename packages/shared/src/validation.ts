import { z } from "zod";
import {
  EXCITEMENT_MAX,
  EXCITEMENT_MIN,
  ITEM_STATUSES,
  LOG_FORMATS,
  MEDIA_TYPES,
  STOREFRONTS,
} from "./types.js";
import type { ReplicatedLibraryItem } from "./types.js";
import { MOMENT_PATTERN } from "./moments.js";

const moment = z.string().regex(MOMENT_PATTERN);
const EPISODE_KEY = /^s\d{1,3}e\d{1,4}$/;

/**
 * Zod mirror of {@link ReplicatedLibraryItem} (document fields + `_deleted`).
 * The server validates every document it receives at the push boundary
 * against this before writing to SQLite — the runtime guard against
 * client/server drift.
 */
const itemFields = z.object({
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
  // Moments (instant or bare day, see moments.ts), one per completion.
  completions: z.array(moment).max(100),
  notes: z.string().max(10000),
  // TV episode keys ("s<season>e<episode>", see episodeKey()) → the moment
  // it was watched ("" = unknown); {} for every other media type.
  watchedEpisodes: z
    .record(z.string(), z.string())
    .refine(
      (r) =>
        Object.keys(r).length <= 10000 &&
        Object.entries(r).every(
          ([k, v]) =>
            EPISODE_KEY.test(k) && (v === "" || MOMENT_PATTERN.test(v)),
        ),
      { message: "invalid watchedEpisodes" },
    ),
});

export const libraryItemDocSchema: z.ZodType<
  ReplicatedLibraryItem,
  z.ZodTypeDef,
  unknown
> = itemFields.extend({
  activity: z
    .array(
      z
        .object({
          id: z.string().min(1).max(64),
          at: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          changes: itemFields
            .pick({
              status: true,
              progressFormat: true,
              progressValue: true,
              platforms: true,
              rating: true,
              completions: true,
              notes: true,
            })
            .partial()
            .extend({
              watchedEpisodes: z
                .record(
                  z.string().regex(EPISODE_KEY),
                  z.union([moment, z.literal("")]).nullable(),
                )
                .optional(),
            })
            .strict(),
        })
        .strict(),
    )
    .default([]),
  // Defaults to unset so a client built before the field existed can still
  // push (mirrors `activity`'s default).
  excitement: z
    .number()
    .int()
    .min(EXCITEMENT_MIN)
    .max(EXCITEMENT_MAX)
    .nullable()
    .default(null),
  // Same default-to-unset reasoning as `excitement`.
  storefront: z.enum(STOREFRONTS).nullable().default(null),
  _deleted: z.boolean(),
});
