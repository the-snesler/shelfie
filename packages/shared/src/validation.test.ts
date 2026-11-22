import { describe, expect, it } from "vitest";
import { libraryItemDocSchema, STOREFRONTS } from "./index.js";
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
  excitement: null,
  storefront: null,
  completions: [],
  notes: "",
  watchedEpisodes: {},
  activity: [],
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
      watchedEpisodes: {
        s1e1: "2024-01-02",
        s1e2: "2024-01-03T02:41:00.000Z",
        s0e12: "",
        s10e999: "2020-12-31",
      },
    };
    expect(libraryItemDocSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects malformed episode keys", () => {
    for (const key of ["1x3", "s1", "e3", "S1E3", "s1e"]) {
      const doc = { ...base, watchedEpisodes: { [key]: "2024-01-02" } };
      expect(libraryItemDocSchema.safeParse(doc).success).toBe(false);
    }
  });

  it("rejects malformed watch moments", () => {
    for (const moment of ["2024-13-40", "2024-01-03T02:41Z"]) {
      const doc = { ...base, watchedEpisodes: { s1e1: moment } };
      expect(libraryItemDocSchema.safeParse(doc).success).toBe(false);
    }
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

describe("libraryItemDocSchema excitement", () => {
  it("accepts integer levels 1–4 and null", () => {
    for (const excitement of [1, 2, 3, 4, null]) {
      expect(
        libraryItemDocSchema.safeParse({ ...base, excitement }).success,
      ).toBe(true);
    }
  });

  it("rejects out-of-range or fractional levels", () => {
    for (const excitement of [0, 5, 2.5, -1, "3"]) {
      expect(
        libraryItemDocSchema.safeParse({ ...base, excitement }).success,
      ).toBe(false);
    }
  });

  it("defaults a missing excitement to null (pushes from older clients)", () => {
    const { excitement: _omit, ...rest } = base;
    void _omit;
    const parsed = libraryItemDocSchema.parse(rest);
    expect(parsed.excitement).toBeNull();
  });
});

describe("libraryItemDocSchema storefront", () => {
  it("accepts every known store and null", () => {
    for (const storefront of [...STOREFRONTS, null]) {
      expect(
        libraryItemDocSchema.safeParse({ ...base, storefront }).success,
      ).toBe(true);
    }
  });

  it("rejects unknown stores", () => {
    for (const storefront of ["origin", "", "STEAM", 1]) {
      expect(
        libraryItemDocSchema.safeParse({ ...base, storefront }).success,
      ).toBe(false);
    }
  });

  it("defaults a missing storefront to null (pushes from older clients)", () => {
    const { storefront: _omit, ...rest } = base;
    void _omit;
    expect(libraryItemDocSchema.parse(rest).storefront).toBeNull();
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

describe("libraryItemDocSchema completions", () => {
  it("accepts bare days and canonical UTC instants", () => {
    expect(
      libraryItemDocSchema.safeParse({
        ...base,
        completions: ["2024-12-31", "2024-12-31T23:59:59.999Z"],
      }).success,
    ).toBe(true);
  });

  it("rejects instants that aren't Date#toISOString output", () => {
    for (const moment of [
      "2024-12-31T23:59:59Z",
      "2024-12-31T23:59:59.000+01:00",
      "2024-12-31T24:00:00.000Z",
      "2024-12-31 23:59:59.000Z",
    ]) {
      expect(
        libraryItemDocSchema.safeParse({ ...base, completions: [moment] })
          .success,
      ).toBe(false);
    }
  });

  it("rejects malformed dates", () => {
    expect(
      libraryItemDocSchema.safeParse({
        ...base,
        completions: ["2024-13-01"],
      }).success,
    ).toBe(false);
    expect(
      libraryItemDocSchema.safeParse({
        ...base,
        completions: ["12/31/2024"],
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

describe("libraryItemDocSchema activity", () => {
  it("defaults old clients to an empty history", () => {
    const { activity: _, ...legacy } = base;
    expect(libraryItemDocSchema.parse(legacy).activity).toEqual([]);
  });
  it("validates timestamps, fields, and episode changes", () => {
    const event = {
      id: "event",
      at: 123,
      changes: {
        status: "finished",
        progressFormat: "percent",
        progressValue: 50,
        completions: ["2026-01-01T20:00:00.000Z"],
        watchedEpisodes: {
          s1e1: null,
          s1e2: "",
          s1e3: "2026-01-01T20:00:00.000Z",
        },
      },
    };
    expect(
      libraryItemDocSchema.safeParse({ ...base, activity: [event] }).success,
    ).toBe(true);
    for (const bad of [
      { ...event, at: -1 },
      { ...event, changes: { status: "nope" } },
      { ...event, changes: { progressValue: -1 } },
      { ...event, changes: { watchedEpisodes: { bad: "2026-01-01" } } },
      { ...event, changes: { watchedEpisodes: { s1e1: "yesterday" } } },
      { ...event, changes: { completedDates: ["2026-01-01"] } },
    ]) {
      expect(
        libraryItemDocSchema.safeParse({ ...base, activity: [bad] }).success,
      ).toBe(false);
    }
  });
});
