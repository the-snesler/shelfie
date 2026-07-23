import { describe, expect, it } from "vitest";
import { libraryItemDocSchema } from "./index.js";
import type { ReplicatedLibraryItem } from "./types.js";

const base: ReplicatedLibraryItem = {
  id: "game:1942",
  mediaType: "game",
  sourceId: "1942",
  status: "active",
  progressFormat: "hours",
  progressValue: 50,
  addedAt: 1,
  updatedAt: 2,
  platforms: [],
  rating: null,
  completedDates: [],
  notes: "",
  watchedEpisodes: {},
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

describe("libraryItemDocSchema progress fields", () => {
  it("accepts null progressValue", () => {
    const doc = {
      ...base,
      status: "wishlisted" as const,
      progressValue: null,
    };
    expect(libraryItemDocSchema.safeParse(doc).success).toBe(true);
  });

  it("accepts a fractional hours value", () => {
    expect(
      libraryItemDocSchema.safeParse({
        ...base,
        progressFormat: "hours",
        progressValue: 24.5,
      }).success,
    ).toBe(true);
  });

  it("accepts progressValue at zero", () => {
    expect(
      libraryItemDocSchema.safeParse({ ...base, progressValue: 0 }).success,
    ).toBe(true);
  });

  it("rejects negative progressValue", () => {
    expect(
      libraryItemDocSchema.safeParse({ ...base, progressValue: -1 }).success,
    ).toBe(false);
  });

  it("rejects an unknown progressFormat", () => {
    expect(
      libraryItemDocSchema.safeParse({ ...base, progressFormat: "chapters" })
        .success,
    ).toBe(false);
  });

  it("accepts a pages progressValue", () => {
    expect(
      libraryItemDocSchema.safeParse({
        ...base,
        id: "book:12345",
        mediaType: "book",
        sourceId: "12345",
        progressFormat: "pages",
        progressValue: 210,
      }).success,
    ).toBe(true);
  });
});

describe("libraryItemDocSchema status", () => {
  it("rejects an unknown status", () => {
    const doc = { ...base, status: "unknown" };
    expect(libraryItemDocSchema.safeParse(doc).success).toBe(false);
  });
});

describe("libraryItemDocSchema mediaType", () => {
  it("accepts every media type", () => {
    for (const mediaType of ["game", "movie", "tv", "book"] as const) {
      const doc = {
        ...base,
        id: `${mediaType}:1942`,
        mediaType,
      };
      expect(libraryItemDocSchema.safeParse(doc).success).toBe(true);
    }
  });

  it("rejects an unknown mediaType", () => {
    const doc = { ...base, id: "album:1", mediaType: "album" };
    expect(libraryItemDocSchema.safeParse(doc).success).toBe(false);
  });
});

describe("libraryItemDocSchema watchedEpisodes", () => {
  it("accepts episode key -> date entries including specials and unknown dates", () => {
    const doc = {
      ...base,
      id: "tv:1396",
      mediaType: "tv",
      watchedEpisodes: { s1e1: "2024-01-02", s0e12: "", s10e999: "2020-12-31" },
    };
    expect(libraryItemDocSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects malformed episode keys", () => {
    for (const key of ["1x3", "s1", "e3", "S1E3", "s1e"]) {
      const doc = { ...base, watchedEpisodes: { [key]: "2024-01-02" } };
      expect(libraryItemDocSchema.safeParse(doc).success).toBe(false);
    }
  });

  it("rejects malformed watch dates", () => {
    const doc = { ...base, watchedEpisodes: { s1e1: "2024-13-40" } };
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

describe("libraryItemDocSchema rating", () => {
  it("accepts half-step ratings and null", () => {
    expect(
      libraryItemDocSchema.safeParse({ ...base, rating: 0.5 }).success,
    ).toBe(true);
    expect(libraryItemDocSchema.safeParse({ ...base, rating: 5 }).success).toBe(
      true,
    );
    expect(
      libraryItemDocSchema.safeParse({ ...base, rating: null }).success,
    ).toBe(true);
  });

  it("rejects out-of-range or non-half-step ratings", () => {
    expect(libraryItemDocSchema.safeParse({ ...base, rating: 0 }).success).toBe(
      false,
    );
    expect(
      libraryItemDocSchema.safeParse({ ...base, rating: 5.5 }).success,
    ).toBe(false);
    expect(
      libraryItemDocSchema.safeParse({ ...base, rating: 0.25 }).success,
    ).toBe(false);
  });
});

describe("libraryItemDocSchema completedDates", () => {
  it("accepts a valid ISO calendar date list", () => {
    expect(
      libraryItemDocSchema.safeParse({
        ...base,
        completedDates: ["2024-12-31"],
      }).success,
    ).toBe(true);
  });

  it("rejects malformed dates", () => {
    expect(
      libraryItemDocSchema.safeParse({
        ...base,
        completedDates: ["2024-13-01"],
      }).success,
    ).toBe(false);
    expect(
      libraryItemDocSchema.safeParse({
        ...base,
        completedDates: ["12/31/2024"],
      }).success,
    ).toBe(false);
  });
});

describe("libraryItemDocSchema notes", () => {
  it("accepts a plain string", () => {
    expect(
      libraryItemDocSchema.safeParse({ ...base, notes: "great game" }).success,
    ).toBe(true);
  });
});
