import { describe, expect, it } from "vitest";
import { normalizeTitle, rankSearchGames } from "./rank.js";

const first = (
  q: string,
  games: { name: string; total_rating_count?: number; hypes?: number }[],
) => rankSearchGames(q, games)[0].name;

describe("normalizeTitle", () => {
  it("lowercases and collapses punctuation to single spaces", () => {
    expect(normalizeTitle("  Super Mario 64: The-Game!! ")).toBe(
      "super mario 64 the game",
    );
  });
});

describe("rankSearchGames", () => {
  it("ranks the exact match above a longer prefixed title", () => {
    // IGDB-style mis-order: sequel/expansion first.
    expect(
      first("elden ring", [
        { name: "Elden Ring Nightreign", hypes: 500 },
        { name: "Elden Ring", total_rating_count: 3000 },
      ]),
    ).toBe("Elden Ring");
    expect(
      first("super mario 64", [
        { name: "Super Mario 64 2" },
        { name: "Super Mario 64", total_rating_count: 900 },
      ]),
    ).toBe("Super Mario 64");
  });

  it("breaks an exact-match tie by popularity", () => {
    expect(
      first("hades", [
        { name: "Hades", total_rating_count: 0 }, // obscure old game
        { name: "Hades", total_rating_count: 2500 }, // 2020 hit
      ]),
    ).toBe("Hades");
    // sanity: the popular one is a distinct object, so assert its count won.
    expect(
      rankSearchGames("hades", [
        { name: "Hades", total_rating_count: 0 },
        { name: "Hades", total_rating_count: 2500 },
      ])[0].total_rating_count,
    ).toBe(2500);
  });

  it("keeps a close typo via the fuzzy tier over an unrelated title", () => {
    expect(
      first("eldn ring", [
        { name: "Ring Fit Adventure", total_rating_count: 800 },
        { name: "Elden Ring", total_rating_count: 3000 },
      ]),
    ).toBe("Elden Ring");
  });

  it("is a stable no-op ordering for an all-punctuation query", () => {
    const games = [{ name: "A" }, { name: "B" }];
    expect(rankSearchGames("!!!", games).map((g) => g.name)).toEqual([
      "A",
      "B",
    ]);
  });
});
