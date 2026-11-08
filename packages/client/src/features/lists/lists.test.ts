import type { LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { describe, expect, it } from "vitest";
import { compareLibraryItems } from "../library/librarySorting";
import type { CardMeta } from "../media/useLibraryData";
import {
  allLists,
  findList,
  listMembers,
  listVisible,
  STATIC_LISTS,
  type AutoList,
} from "./automaticLists";
import { listStats } from "./listStats";
import { parseMediaType, resolveListViewState } from "./listViewState";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 7);
const CTX = { now: NOW, today: "2026-11-07" };

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
    activity: [],
    addedAt: 1,
    updatedAt: NOW,
    ...overrides,
  } as RxDocument<LibraryItem>;
}

function list(id: string): AutoList {
  const found = findList(id);
  if (!found) throw new Error(`no list ${id}`);
  return found;
}

const ids = (items: readonly LibraryItem[]) => items.map((i) => i.id).sort();

describe("automatic lists", () => {
  const library = [
    item("game:1", {
      status: "dropped",
      platforms: ["PC (Microsoft Windows)"],
    }),
    item("game:2", { status: "finished", completedDates: ["2026-10-01"] }),
    item("book:3", { status: "dropped" }),
    item("movie:4", {
      status: "finished",
      rating: 5,
      completedDates: ["2020-01-01", "2024-03-02"],
    }),
    item("tv:5", { status: "active", updatedAt: NOW - 120 * DAY }),
    item("game:6", { status: "paused", platforms: ["Nintendo Switch"] }),
  ];

  it("answers 'played but not finished' with the dropped list for games", () => {
    expect(ids(listMembers(list("dropped"), library, "game", CTX))).toEqual([
      "game:1",
    ]);
    expect(list("dropped").label("game")).toBe("Played");
    expect(list("dropped").label(null)).toBe("Dropped");
  });

  it("files dropped titles under Done", () => {
    expect(list("done").label(null)).toBe("Done");
    expect(ids(listMembers(list("done"), library, null, CTX))).toEqual([
      "book:3",
      "game:1",
      "game:2",
      "movie:4",
    ]);
  });

  it("evaluates the smart lists", () => {
    expect(ids(listMembers(list("unrated"), library, null, CTX))).toEqual([
      "game:2",
    ]);
    expect(ids(listMembers(list("top-rated"), library, null, CTX))).toEqual([
      "movie:4",
    ]);
    expect(ids(listMembers(list("revisited"), library, null, CTX))).toEqual([
      "movie:4",
    ]);
    expect(
      ids(listMembers(list("recently-finished"), library, null, CTX)),
    ).toEqual(["game:2"]);
    expect(ids(listMembers(list("dusty"), library, null, CTX))).toEqual([
      "tv:5",
    ]);
  });

  it("builds one game-only list per platform in use", () => {
    const platforms = allLists(library).filter((l) => l.section === "platform");
    expect(platforms.map((l) => l.label(null))).toEqual([
      "Nintendo Switch",
      "PC (Microsoft Windows)",
    ]);
    const pc = list("platform:PC (Microsoft Windows)");
    expect(ids(listMembers(pc, library, null, CTX))).toEqual(["game:1"]);
    expect(listVisible(pc, "movie", 0)).toBe(false);
    expect(listMembers(pc, library, "movie", CTX)).toEqual([]);
  });

  it("hides statuses a media type doesn't offer unless something has one", () => {
    const paused = list("paused");
    expect(listVisible(paused, "movie", 0)).toBe(false);
    expect(listVisible(paused, "movie", 2)).toBe(true);
    expect(listVisible(paused, null, 0)).toBe(true);
    expect(listVisible(list("completed"), "book", 0)).toBe(false);
  });

  it("has one list per status and per group, with unique ids", () => {
    const statuses = STATIC_LISTS.filter((l) => l.section === "status");
    const groups = STATIC_LISTS.filter((l) => l.section === "group");
    expect(statuses).toHaveLength(7);
    expect(groups.map((l) => l.id)).toEqual(["planned", "in-progress", "done"]);
    const allIds = STATIC_LISTS.map((l) => l.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(findList("nope")).toBeNull();
    expect(findList("platform:")).toBeNull();
  });
});

describe("compareLibraryItems", () => {
  const cards = new Map<string, CardMeta>([
    ["game:1", { name: "Alpha" } as CardMeta],
    ["game:2", { name: "Beta" } as CardMeta],
    ["game:3", { name: "Gamma" } as CardMeta],
  ]);
  const sorted = (
    items: RxDocument<LibraryItem>[],
    sort: Parameters<typeof compareLibraryItems>[2],
    dir?: "asc" | "desc",
  ) =>
    [...items]
      .sort((a, b) => compareLibraryItems(a, b, sort, cards, dir))
      .map((i) => i.id);

  it("sorts by rating highest first, unrated last either way", () => {
    const items = [
      item("game:1"),
      item("game:2", { rating: 3 }),
      item("game:3", { rating: 4.5 }),
    ];
    expect(sorted(items, "rating")).toEqual(["game:3", "game:2", "game:1"]);
    expect(sorted(items, "rating", "asc")).toEqual([
      "game:2",
      "game:3",
      "game:1",
    ]);
  });

  it("sorts by latest completion, never-finished last", () => {
    const items = [
      item("game:1", { completedDates: ["2025-01-01", "2026-06-01"] }),
      item("game:2"),
      item("game:3", { completedDates: ["2026-01-01"] }),
    ];
    expect(sorted(items, "completed")).toEqual(["game:1", "game:3", "game:2"]);
  });

  it("sorts by date added and reverses A–Z", () => {
    const items = [
      item("game:1", { addedAt: 1 }),
      item("game:2", { addedAt: 3 }),
      item("game:3", { addedAt: 2 }),
    ];
    expect(sorted(items, "added")).toEqual(["game:2", "game:3", "game:1"]);
    expect(sorted(items, "title", "desc")).toEqual([
      "game:3",
      "game:2",
      "game:1",
    ]);
  });

  it("counts finished titles as complete for progress, dropped as unknown", () => {
    const items = [
      item("game:1", { status: "dropped" }),
      item("game:2", { status: "active", progressValue: 40 }),
      item("game:3", { status: "finished" }),
    ];
    expect(sorted(items, "progress")).toEqual(["game:3", "game:2", "game:1"]);
  });
});

describe("list view state", () => {
  const dusty = list("dusty");
  const params = (query: string) => new URLSearchParams(query);

  it("falls back to the list's defaults", () => {
    expect(resolveListViewState(params(""), null, dusty)).toEqual({
      view: "shelf",
      sort: "recent",
      dir: "asc",
      group: "none",
    });
    expect(resolveListViewState(params(""), null, list("done")).group).toBe(
      "status",
    );
  });

  it("prefers the URL, then what was stored, and ignores junk", () => {
    const stored = { view: "list", sort: "rating", dir: "asc", group: "type" };
    expect(resolveListViewState(params(""), stored, dusty)).toEqual(stored);
    expect(
      resolveListViewState(params("sort=title&view=bogus"), stored, dusty),
    ).toEqual({ view: "list", sort: "title", dir: "asc", group: "type" });
    expect(
      resolveListViewState(params("sort=added"), { dir: "asc" }, dusty).dir,
    ).toBe("desc");
    expect(
      resolveListViewState(
        params("sort=nope&dir=sideways"),
        { sort: 3 },
        dusty,
      ),
    ).toMatchObject({ sort: "recent", dir: "asc" });
  });

  it("parses the media filter", () => {
    expect(parseMediaType("game")).toBe("game");
    expect(parseMediaType("vinyl")).toBeNull();
    expect(parseMediaType(null)).toBeNull();
  });
});

describe("listStats", () => {
  it("averages ratings and totals logged hours and completions", () => {
    const stats = listStats([
      item("game:1", {
        rating: 4,
        progressFormat: "hours",
        progressValue: 12.5,
      }),
      item("book:2", { rating: 3, progressFormat: "hours", progressValue: 2 }),
      item("book:3", { progressFormat: "pages", progressValue: 300 }),
      item("movie:4", { completedDates: ["2026-01-01", "2026-02-01"] }),
    ]);
    expect(stats).toMatchObject({
      count: 4,
      ratedCount: 2,
      avgRating: 3.5,
      hoursLogged: 14.5,
      completions: 2,
      byType: { game: 1, book: 2, movie: 1, tv: 0 },
    });
    expect(listStats([]).avgRating).toBeNull();
  });
});
