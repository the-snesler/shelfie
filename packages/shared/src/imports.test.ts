import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMPORT_POLICY,
  IMPORT_BUCKETS,
  IMPORT_SOURCE_CAPABILITIES,
  importBucket,
} from "./imports.js";
import { ITEM_STATUSES, MEDIA_TYPES } from "./types.js";

describe("import buckets", () => {
  it("groups every status into a bucket every bucket is reachable from", () => {
    const buckets = ITEM_STATUSES.map(importBucket);
    expect(new Set(buckets)).toEqual(new Set(IMPORT_BUCKETS));
  });
  it("defaults to finished and in-progress entries of every media type", () => {
    expect(
      IMPORT_BUCKETS.filter((bucket) => DEFAULT_IMPORT_POLICY.buckets[bucket]),
    ).toEqual(["completed", "inProgress"]);
    expect(DEFAULT_IMPORT_POLICY.mediaTypes).toEqual([...MEDIA_TYPES]);
    for (const { mediaTypes } of Object.values(IMPORT_SOURCE_CAPABILITIES))
      for (const mediaType of mediaTypes)
        expect(MEDIA_TYPES).toContain(mediaType);
  });
});
