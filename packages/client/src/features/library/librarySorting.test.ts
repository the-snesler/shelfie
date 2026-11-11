import type { LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { describe, expect, it } from "vitest";
import type { GameCardDoc } from "../../db/gameCards";
import type { MovieCardDoc } from "../../db/movieCards";
import type { TvCardDoc } from "../../db/tvCards";
import {
  compareLibraryItems,
  comparePlannedItems,
  compareUnreleasedItems,
  NATURAL_DIRECTION,
  normalizeManualOrder,
  shelfSection,
} from "./librarySorting";
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
    excitement: null,
    completedDates: [],
    notes: "",
    watchedEpisodes: {},
    activity: [],
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

  it("compares IGDB epoch dates with ISO release dates", () => {
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
        {
          id: movie.id,
          name: "Newer movie",
          releaseDate: "2020-03-01",
        } as MovieCardDoc,
      ],
    ]);

    expect(comparePlannedItems(game, movie, "release", cards)).toBeGreaterThan(
      0,
    );
  });

  it("sorts by excitement highest first, unset last either way", () => {
    const items = [
      item("game:1"),
      item("game:2", { excitement: 2 }),
      item("game:3", { excitement: 4 }),
      item("game:4", { excitement: 2 }),
    ];
    const cards = new Map<string, CardMeta>([
      ["game:2", { id: "game:2", name: "Beta" } as GameCardDoc],
      ["game:4", { id: "game:4", name: "Alpha" } as GameCardDoc],
    ]);
    const order = (direction?: "asc" | "desc") =>
      [...items]
        .sort((a, b) =>
          compareLibraryItems(a, b, "excitement", cards, direction),
        )
        .map((i) => i.id);

    expect(NATURAL_DIRECTION.excitement).toBe("desc");
    // Ties on excitement fall back to A–Z (Alpha before Beta).
    expect(order()).toEqual(["game:3", "game:4", "game:2", "game:1"]);
    expect(order("asc")).toEqual(["game:4", "game:2", "game:3", "game:1"]);
    expect(
      [...items]
        .sort((a, b) => comparePlannedItems(a, b, "excitement", cards))
        .map((i) => i.id),
    ).toEqual(order());
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

describe("unreleased shelf", () => {
  const today = "2026-11-06";
  const movie = (id: string, releaseDate: string | null) =>
    ({ id, name: id, releaseDate }) as MovieCardDoc;

  it("splits released wishlisted titles into Wishlist when asked", () => {
    const released = movie("movie:1", today);
    expect(
      shelfSection(
        item("movie:1", { status: "wishlisted" }),
        released,
        today,
        true,
      ),
    ).toBe("wishlist");
    expect(
      shelfSection(
        item("movie:1", { status: "wishlisted" }),
        movie("movie:1", "2026-12-25"),
        today,
        true,
      ),
    ).toBe("unreleased");
    expect(
      shelfSection(
        item("movie:1", { status: "backlogged" }),
        released,
        today,
        true,
      ),
    ).toBe("planned");
  });

  it("orders by soonest release, with TBA titles last", () => {
    const later = item("movie:1", { status: "wishlisted" });
    const sooner = item("movie:2", { status: "wishlisted" });
    const tba = item("tv:3", { status: "wishlisted" });
    const cards = new Map<string, CardMeta>([
      [later.id, movie(later.id, "2027-05-01")],
      [sooner.id, movie(sooner.id, "2026-12-01")],
      [
        tba.id,
        {
          id: tba.id,
          name: "Show",
          firstAirDate: null,
          firstAirYear: null,
          status: "Planned",
          numberOfEpisodes: 0,
        } as unknown as TvCardDoc,
      ],
    ]);

    expect(
      [tba, later, sooner]
        .sort((a, b) => compareUnreleasedItems(a, b, cards, today))
        .map((entry) => entry.id),
    ).toEqual(["movie:2", "movie:1", "tv:3"]);
  });
});
