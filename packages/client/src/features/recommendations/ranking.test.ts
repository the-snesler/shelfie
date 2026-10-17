import type { LibraryItem, MediaType } from "@shelfie/shared";
import { describe, expect, it } from "vitest";
import type { BookCardDoc } from "../../db/bookCards";
import type { CardMeta } from "../../db/cardCache";
import type { MovieCardDoc } from "../../db/movieCards";
import { rankRecommendations } from "./ranking";

function item(id: string, overrides: Partial<LibraryItem> = {}): LibraryItem {
  const [mediaType, sourceId] = id.split(":");
  return {
    id,
    mediaType: mediaType as MediaType,
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
    updatedAt: 1,
    ...overrides,
  };
}

function movie(
  id: number,
  overrides: Partial<MovieCardDoc> = {},
): MovieCardDoc {
  return {
    id: `movie:${id}`,
    tmdbId: id,
    name: `Movie ${id}`,
    posterPath: null,
    genres: [],
    director: null,
    releaseDate: "2020-01-01",
    runtime: 100,
    ...overrides,
  };
}

function book(id: number, authors: string[]): BookCardDoc {
  return {
    id: `book:${id}`,
    goodreadsId: id,
    name: `Book ${id}`,
    coverUrl: null,
    authors,
    publicationDate: null,
    pageCount: 250,
  };
}

const today = "2026-10-17";
const profile = item("movie:1", { status: "finished", rating: 4.5 });

describe("shelf recommendations", () => {
  it("ranks a shared creator above a shared genre and explains the actual rated title", () => {
    const cards = new Map<string, CardMeta>([
      ["movie:1", movie(1, { genres: ["Drama"], director: "Director" })],
      ["movie:2", movie(2, { genres: ["Drama"] })],
      ["movie:3", movie(3, { director: "Director" })],
    ]);
    const picks = rankRecommendations(
      [profile, item("movie:2"), item("movie:3")],
      cards,
      { today },
    );
    expect(picks.map((pick) => pick.item.id)).toEqual(["movie:3", "movie:2"]);
    expect(picks[0].reasons[0]).toBe("Director, like Movie 1 (4.5 stars)");
    expect(picks[1].reasons[0]).toBe("Drama, like Movie 1 (4.5 stars)");
  });

  it("matches book authors without needing book detail metadata", () => {
    const picks = rankRecommendations(
      [item("book:1", { status: "finished", rating: 5 }), item("book:2")],
      new Map([
        ["book:1", book(1, ["Ursula K. Le Guin"])],
        ["book:2", book(2, ["Ursula K. Le Guin"])],
      ]),
      { today },
    );
    expect(picks[0].reasons[0]).toBe(
      "Ursula K. Le Guin, like Book 1 (5 stars)",
    );
  });

  it("excludes active, finished, completed, and dropped titles from picks", () => {
    const statuses = [
      "active",
      "finished",
      "completed",
      "dropped",
      "backlogged",
      "wishlisted",
      "paused",
    ] as const;
    const items = statuses.map((status, index) =>
      item(`movie:${index}`, { status }),
    );
    const cards = new Map(
      items.map((entry, index) => [entry.id, movie(index)]),
    );
    expect(
      rankRecommendations(items, cards, { today })
        .map((pick) => pick.item.status)
        .sort(),
    ).toEqual(["backlogged", "paused", "wishlisted"]);
  });

  it("ignores low ratings and dropped items when learning preferences", () => {
    const picks = rankRecommendations(
      [
        item("movie:1", { rating: 3.5, status: "finished" }),
        item("movie:2", { rating: 5, status: "dropped" }),
        item("movie:3"),
      ],
      new Map(
        [1, 2, 3].map((id) => [
          `movie:${id}`,
          movie(id, { genres: ["Drama"] }),
        ]),
      ),
      { today },
    );
    expect(picks[0].reasons).toEqual(["Already in your backlog"]);
  });

  it("does not use a queued title's own rating as matching evidence", () => {
    const picks = rankRecommendations(
      [item("movie:1", { rating: 5 })],
      new Map([["movie:1", movie(1, { genres: ["Drama"] })]]),
      { today },
    );
    expect(picks[0].reasons).toEqual(["Already in your backlog"]);
  });

  it("keeps preference matching within a medium and respects the media filter", () => {
    const entries = [profile, item("movie:2"), item("tv:3")];
    const cards = new Map<string, CardMeta>([
      ["movie:1", movie(1, { genres: ["Drama"] })],
      ["movie:2", movie(2, { genres: ["Drama"] })],
      [
        "tv:3",
        {
          id: "tv:3",
          name: "Show",
          genres: ["Drama"],
          firstAirYear: 2020,
        } as CardMeta,
      ],
    ]);
    const picks = rankRecommendations(entries, cards, {
      today,
      mediaType: "tv",
    });
    expect(picks.map((pick) => pick.item.id)).toEqual(["tv:3"]);
    expect(picks[0].reasons).toEqual(["Already in your backlog"]);
  });

  it("excludes known future releases while allowing unknown release dates", () => {
    const entries = [item("movie:1"), item("movie:2"), item("movie:3")];
    const cards = new Map<string, CardMeta>([
      ["movie:1", movie(1, { releaseDate: "2026-10-18" })],
      ["movie:2", movie(2, { releaseDate: null })],
      ["movie:3", movie(3, { releaseDate: today })],
    ]);
    expect(
      rankRecommendations(entries, cards, { today }).map(
        (pick) => pick.item.id,
      ),
    ).toEqual(["movie:2", "movie:3"]);
  });

  it("does not invent titles for missing card metadata", () => {
    expect(rankRecommendations([item("book:1")], new Map(), { today })).toEqual(
      [],
    );
  });

  it("normalizes repeated/case-varied features without inflating a match", () => {
    const entries = [profile, item("movie:2"), item("movie:3")];
    const cards = new Map<string, CardMeta>([
      ["movie:1", movie(1, { genres: ["Drama", "Drama"] })],
      ["movie:2", movie(2, { genres: [" Drama ", "DRAMA"] })],
      ["movie:3", movie(3, { genres: ["Drama"] })],
    ]);
    const picks = rankRecommendations(entries, cards, { today });
    expect(picks[0].score).toBe(picks[1].score);
    expect(picks[0].reasons).toHaveLength(1);
  });

  it("offers honest fallback reasons and deterministic bounded ordering", () => {
    const entries = [
      item("movie:1", { status: "paused" }),
      item("movie:2", { updatedAt: 5 }),
      item("movie:3", { status: "wishlisted" }),
    ];
    const cards = new Map([1, 2, 3].map((id) => [`movie:${id}`, movie(id)]));
    const picks = rankRecommendations(entries, cards, { today, limit: 2 });
    expect(picks.map((pick) => pick.item.id)).toEqual(["movie:1", "movie:2"]);
    expect(picks[0].reasons).toEqual(["Pick up where you left off"]);
    expect(rankRecommendations(entries, cards, { today, limit: 0 })).toEqual(
      [],
    );
  });
});
