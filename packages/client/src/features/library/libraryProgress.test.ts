import { describe, expect, it } from "vitest";
import type { LibraryItem } from "@shelfie/shared";
import { libraryProgressPercent } from "./libraryProgress";

const item: LibraryItem = {
  id: "game:1",
  mediaType: "game",
  sourceId: "1",
  status: "active",
  progressFormat: "percent",
  progressValue: 40,
  platforms: [],
  rating: null,
  completedDates: [],
  notes: "",
  watchedEpisodes: {},
  addedAt: 1,
  updatedAt: 1,
};

describe("libraryProgressPercent", () => {
  it("uses direct percentages and clamps them", () => {
    expect(libraryProgressPercent(item, undefined)).toBe(40);
    expect(
      libraryProgressPercent({ ...item, progressValue: 120 }, undefined),
    ).toBe(100);
  });

  it("derives game hours and book pages from metadata", () => {
    expect(
      libraryProgressPercent(
        { ...item, progressFormat: "hours", progressValue: 10 },
        { timeToBeat: { normally: 20 * 3600 } } as never,
      ),
    ).toBe(50);
    expect(
      libraryProgressPercent(
        {
          ...item,
          id: "book:1",
          mediaType: "book",
          progressFormat: "pages",
          progressValue: 75,
        },
        { pageCount: 300 } as never,
      ),
    ).toBe(25);
  });

  it("derives TV progress while excluding specials", () => {
    expect(
      libraryProgressPercent(
        {
          ...item,
          id: "tv:1",
          mediaType: "tv",
          watchedEpisodes: { s0e1: "", s1e1: "", s1e2: "" },
        },
        { numberOfEpisodes: 8 } as never,
      ),
    ).toBe(25);
  });

  it("omits unavailable, movie, and finished progress", () => {
    expect(
      libraryProgressPercent(
        { ...item, progressFormat: "hours", progressValue: 10 },
        undefined,
      ),
    ).toBeNull();
    expect(
      libraryProgressPercent({ ...item, mediaType: "movie" }, undefined),
    ).toBeNull();
    expect(
      libraryProgressPercent({ ...item, status: "finished" }, undefined),
    ).toBeNull();
  });
});
