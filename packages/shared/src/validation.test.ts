import { describe, expect, it } from "vitest";
import { libraryItemDocSchema } from "./index.js";
import type { ReplicatedLibraryItem } from "./types.js";

const base: ReplicatedLibraryItem = {
  id: "game:1942",
  mediaType: "game",
  sourceId: "1942",
  status: "playing",
  progress: 50,
  addedAt: 1,
  updatedAt: 2,
  platforms: [],
  _deleted: false,
};

describe("libraryItemDocSchema id pattern", () => {
  it("accepts a mediaType-prefixed id", () => {
    expect(libraryItemDocSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an id missing the mediaType prefix", () => {
    const doc = { ...base, id: "1942" };
    expect(libraryItemDocSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects an id with a non-numeric sourceId", () => {
    const doc = { ...base, id: "game:abc" };
    expect(libraryItemDocSchema.safeParse(doc).success).toBe(false);
  });
});

describe("libraryItemDocSchema platforms", () => {
  it("accepts a platform list", () => {
    const doc = { ...base, platforms: ["PlayStation 5", "Nintendo Switch"] };
    expect(libraryItemDocSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects a non-string platform entry", () => {
    const doc = { ...base, platforms: [5] };
    expect(libraryItemDocSchema.safeParse(doc).success).toBe(false);
  });
});

describe("libraryItemDocSchema progress bound", () => {
  it("accepts null progress", () => {
    const doc = { ...base, status: "wishlisted" as const, progress: null };
    expect(libraryItemDocSchema.safeParse(doc).success).toBe(true);
  });

  it("accepts progress at the bounds", () => {
    expect(
      libraryItemDocSchema.safeParse({ ...base, progress: 0 }).success,
    ).toBe(true);
    expect(
      libraryItemDocSchema.safeParse({ ...base, progress: 100 }).success,
    ).toBe(true);
  });

  it("rejects progress past the bounds", () => {
    expect(
      libraryItemDocSchema.safeParse({ ...base, progress: 101 }).success,
    ).toBe(false);
    expect(
      libraryItemDocSchema.safeParse({ ...base, progress: -1 }).success,
    ).toBe(false);
  });

  it("rejects non-integer progress", () => {
    expect(
      libraryItemDocSchema.safeParse({ ...base, progress: 50.5 }).success,
    ).toBe(false);
  });
});

describe("libraryItemDocSchema status", () => {
  it("rejects an unknown status", () => {
    const doc = { ...base, status: "unknown" };
    expect(libraryItemDocSchema.safeParse(doc).success).toBe(false);
  });
});

describe("libraryItemDocSchema timestamps", () => {
  it("rejects non-positive addedAt/updatedAt", () => {
    expect(
      libraryItemDocSchema.safeParse({ ...base, addedAt: 0 }).success,
    ).toBe(false);
    expect(
      libraryItemDocSchema.safeParse({ ...base, updatedAt: -1 }).success,
    ).toBe(false);
  });
});
