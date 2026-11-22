import {
  DEFAULT_IMPORT_POLICY,
  IMPORT_SOURCE_CAPABILITIES,
  MEDIA_TYPES,
  importBucket,
  type ImportPolicy,
  type ImportSource,
} from "@shelfie/shared";
import { z } from "zod";
import type { EntryFilter } from "./types.js";

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => new Date(value).toISOString().slice(0, 10) === value,
    "Invalid date",
  );

export const importPolicySchema = z
  .object({
    buckets: z
      .object({
        completed: z.boolean(),
        inProgress: z.boolean(),
        backlog: z.boolean(),
        wishlist: z.boolean(),
        dropped: z.boolean(),
      })
      .strict() satisfies z.ZodType<ImportPolicy["buckets"]>,
    addNew: z.boolean(),
    updateExisting: z.boolean(),
    updateStatuses: z.boolean(),
    since: isoDay.nullable(),
    mediaTypes: z.array(z.enum(MEDIA_TYPES)).max(MEDIA_TYPES.length),
  })
  .strict();

/**
 * Reads a stored policy, filling fields added after it was saved from the
 * defaults so an older row never fails to load.
 */
export function readPolicy(json: string | null): ImportPolicy | null {
  if (!json) return null;
  let stored: Partial<ImportPolicy>;
  try {
    stored = JSON.parse(json) as Partial<ImportPolicy>;
  } catch {
    return null;
  }
  const parsed = importPolicySchema.safeParse({
    ...DEFAULT_IMPORT_POLICY,
    ...stored,
    buckets: { ...DEFAULT_IMPORT_POLICY.buckets, ...stored.buckets },
  });
  return parsed.success ? parsed.data : null;
}

/** The policy as a predicate over source entries, limited to what the source reports. */
export function entryFilter(
  source: ImportSource,
  policy: ImportPolicy,
): EntryFilter {
  const { buckets } = IMPORT_SOURCE_CAPABILITIES[source];
  return ({ mediaType, status, activityDay }) => {
    const bucket = importBucket(status);
    return (
      policy.buckets[bucket] &&
      buckets.includes(bucket) &&
      policy.mediaTypes.includes(mediaType) &&
      !(policy.since && activityDay && activityDay < policy.since)
    );
  };
}
