import { describe, expect, it } from "vitest";
import { equalDocs, type ReplicatedDoc } from "./collection.js";
import type { ReplicatedLibraryItem } from "@shelfie/shared";

const base: ReplicatedLibraryItem = {
  id: "game:1942",
  mediaType: "game",
  sourceId: "1942",
  status: "active",
  progressFormat: "hours",
  progressValue: 10,
  addedAt: 1,
  updatedAt: 10,
  platforms: [],
  rating: null,
  completedDates: [],
  notes: "",
  watchedEpisodes: {},
  _deleted: false,
};

describe("equalDocs", () => {
  it("treats two nulls as equal and a null against a doc as unequal", () => {
    expect(equalDocs(null, null)).toBe(true);
    expect(equalDocs(base, null)).toBe(false);
    expect(equalDocs(null, base)).toBe(false);
  });

  it("ignores key insertion order", () => {
    const reordered: ReplicatedLibraryItem = {
      _deleted: false,
      watchedEpisodes: {},
      notes: "",
      completedDates: [],
      rating: null,
      platforms: [],
      updatedAt: 10,
      addedAt: 1,
      progressValue: 10,
      progressFormat: "hours",
      status: "active",
      sourceId: "1942",
      mediaType: "game",
      id: "game:1942",
    };
    expect(equalDocs(base, reordered)).toBe(true);
  });

  it("ignores underscore-prefixed RxDB internals other than _deleted", () => {
    const withInternals = {
      ...base,
      _rev: "1-abc",
      _meta: { lwt: 1 },
    } as unknown as ReplicatedDoc;
    expect(equalDocs(base, withInternals)).toBe(true);
  });

  it("treats a _deleted difference as unequal", () => {
    const deleted: ReplicatedLibraryItem = { ...base, _deleted: true };
    expect(equalDocs(base, deleted)).toBe(false);
  });

  it("treats a contract field difference as unequal", () => {
    const updated: ReplicatedLibraryItem = { ...base, updatedAt: 20 };
    expect(equalDocs(base, updated)).toBe(false);
  });
});
