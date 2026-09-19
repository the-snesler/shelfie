import type { LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { describe, expect, it } from "vitest";
import type { GameCardDoc } from "../../db/gameCards";
import type { MovieCardDoc } from "../../db/movieCards";
import { comparePlannedItems, normalizeManualOrder } from "./librarySorting";
import type { CardMeta } from "./useLibraryData";

function item(
  id: string,
  overrides: Partial<LibraryItem> = {},
): RxDocument<LibraryItem> {
  const [mediaType, sourceId] = id.split(":") as [
    LibraryItem["mediaType"],
    string,
  ];
  return {
    id,
    mediaType,
    sourceId,
    status: "backlogged",
    progressFormat: "percent",
    progressValue: null,
    platforms: [],
    rating: null,
    completedDates: [],
    notes: "",
    watchedEpisodes: {},
    addedAt: 1,
    updatedAt: 1,
    ...overrides,
  } as RxDocument<LibraryItem>;
}

describe("library sorting", () => {
  it("sorts the most recent interaction first", () => {
    const older = item("book:1", { updatedAt: 10 });
    const newer = item("book:2", { updatedAt: 20 });

    expect(
      comparePlannedItems(older, newer, "recent", new Map()),
    ).toBeGreaterThan(0);
  });

  it("compares IGDB epoch dates with year-only metadata", () => {
    const game = item("game:1");
    const movie = item("movie:2");
    const cards = new Map<string, CardMeta>([
      [
        game.id,
        {
          id: game.id,
          name: "Older game",
          firstReleaseDate: Date.UTC(2020, 0, 1) / 1000,
        } as GameCardDoc,
      ],
      [
        movie.id,
        { id: movie.id, name: "Newer movie", year: 2024 } as MovieCardDoc,
      ],
    ]);

    expect(comparePlannedItems(game, movie, "release", cards)).toBeGreaterThan(
      0,
    );
  });

  it("preserves manual positions, removes stale ids, and appends new items", () => {
    const first = item("book:1", { addedAt: 10 });
    const second = item("book:2", { addedAt: 20 });
    const added = item("book:3", { addedAt: 30 });

    expect(
      normalizeManualOrder(
        [second.id, "book:gone", first.id],
        [first, second, added],
      ),
    ).toEqual([second.id, first.id, added.id]);
  });
});
