import type { TvAiring, TvSeason } from "@shelfie/shared";
import { describe, expect, it } from "vitest";
import { nextEpisodeExpired, scheduleForShow } from "./schedule.js";

const DAY = 24 * 60 * 60 * 1000;

function airing(airDate: string, season = 2, episode = 3): TvAiring {
  return {
    seasonNumber: season,
    episodeNumber: episode,
    name: `Episode ${episode}`,
    airDate,
    stillPath: null,
  };
}

describe("nextEpisodeExpired", () => {
  const next = airing("2026-10-08");
  const boundary = Date.parse("2026-10-10T00:00:00Z");

  it("never expires a show with nothing scheduled", () => {
    expect(nextEpisodeExpired(null, 0, boundary + DAY)).toBe(false);
  });

  it("waits until two UTC midnights past the air date", () => {
    expect(nextEpisodeExpired(next, boundary - 3 * DAY, boundary - 1)).toBe(
      false,
    );
    expect(nextEpisodeExpired(next, boundary - 3 * DAY, boundary)).toBe(true);
  });

  it("expires at most once per airing", () => {
    expect(nextEpisodeExpired(next, boundary + 1, boundary + DAY)).toBe(false);
  });
});

describe("scheduleForShow", () => {
  const seasons: TvSeason[] = [
    {
      seasonNumber: 2,
      name: "Season 2",
      airDate: "2026-10-01",
      posterPath: null,
      episodes: [
        { ...airing("2026-10-01", 2, 1), runtime: null },
        { ...airing("2026-10-08", 2, 2), runtime: null },
        { ...airing("", 2, 3), airDate: "", runtime: null },
        { ...airing("2026-11-20", 2, 4), runtime: null },
      ],
    },
  ];

  it("returns catalog episodes inside the inclusive range, skipping undated ones", () => {
    const result = scheduleForShow(
      7,
      seasons,
      null,
      "2026-10-01",
      "2026-10-31",
    );
    expect(result.map((e) => [e.seasonNumber, e.episodeNumber])).toEqual([
      [2, 1],
      [2, 2],
    ]);
    expect(result.every((e) => e.tmdbId === 7)).toBe(true);
  });

  it("adds the card's next episode when the catalog lacks it", () => {
    const result = scheduleForShow(
      7,
      seasons,
      airing("2026-10-29", 3, 1),
      "2026-10-01",
      "2026-10-31",
    );
    expect(result.map((e) => `${e.seasonNumber}:${e.episodeNumber}`)).toEqual([
      "2:1",
      "2:2",
      "3:1",
    ]);
  });

  it("dedupes the card's next episode against the catalog", () => {
    const result = scheduleForShow(
      7,
      seasons,
      airing("2026-10-08", 2, 2),
      "2026-10-01",
      "2026-10-31",
    );
    expect(result).toHaveLength(2);
  });

  it("works from the card alone when no detail was ever fetched", () => {
    expect(
      scheduleForShow(7, [], airing("2026-10-15"), "2026-10-01", "2026-10-31"),
    ).toHaveLength(1);
  });
});
