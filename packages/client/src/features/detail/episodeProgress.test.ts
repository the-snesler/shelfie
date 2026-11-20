import type { TvEpisode, TvSeason } from "@shelfie/shared";
import { describe, expect, it } from "vitest";
import {
  episodeProgress,
  isEpisodeAired,
  nextUpEpisode,
  orderedSeasons,
} from "./episodeProgress";

function ep(
  seasonNumber: number,
  episodeNumber: number,
  airDate: string | null,
): TvEpisode {
  return {
    seasonNumber,
    episodeNumber,
    name: `S${seasonNumber}E${episodeNumber}`,
    airDate,
    runtime: 24,
    stillPath: null,
  };
}

function season(seasonNumber: number, episodes: TvEpisode[]): TvSeason {
  return {
    seasonNumber,
    name: `Season ${seasonNumber}`,
    airDate: episodes[0]?.airDate ?? null,
    posterPath: null,
    episodes,
  };
}

const today = "2026-08-20";

describe("orderedSeasons", () => {
  it("sorts ascending with specials last", () => {
    const seasons = [season(2, []), season(0, []), season(1, [])];
    expect(orderedSeasons(seasons).map((s) => s.seasonNumber)).toEqual([
      1, 2, 0,
    ]);
  });
});

describe("isEpisodeAired", () => {
  it("compares dated episodes against today", () => {
    expect(isEpisodeAired(ep(1, 7, "2026-08-17"), null, today)).toBe(true);
    expect(isEpisodeAired(ep(1, 8, "2026-08-20"), null, today)).toBe(true);
    expect(isEpisodeAired(ep(1, 9, "2026-08-24"), null, today)).toBe(false);
  });

  it("places undated regular episodes against the last aired one", () => {
    const last = { seasonNumber: 2, episodeNumber: 3 };
    expect(isEpisodeAired(ep(1, 10, null), last, today)).toBe(true);
    expect(isEpisodeAired(ep(2, 3, null), last, today)).toBe(true);
    expect(isEpisodeAired(ep(2, 4, null), last, today)).toBe(false);
    expect(isEpisodeAired(ep(1, 1, null), null, today)).toBe(false);
  });

  it("keeps undated specials toggleable", () => {
    expect(isEpisodeAired(ep(0, 1, null), null, today)).toBe(true);
  });
});

describe("nextUpEpisode", () => {
  const seasons = [
    season(0, [ep(0, 1, "2026-01-01")]),
    season(1, [
      ep(1, 1, "2026-07-06"),
      ep(1, 2, "2026-07-13"),
      ep(1, 3, "2026-08-24"),
    ]),
  ];

  it("returns the first unwatched aired regular episode", () => {
    const next = nextUpEpisode(seasons, { s1e1: "2026-07-07" }, null, today);
    expect(next?.episode.episodeNumber).toBe(2);
    expect(next?.aired).toBe(true);
  });

  it("skips specials and falls back to the next upcoming episode", () => {
    const next = nextUpEpisode(
      seasons,
      { s1e1: "2026-07-07", s1e2: "2026-07-14" },
      null,
      today,
    );
    expect(next?.episode.episodeNumber).toBe(3);
    expect(next?.aired).toBe(false);
  });

  it("is null once everything listed is watched", () => {
    expect(
      nextUpEpisode(
        seasons,
        { s1e1: "x", s1e2: "x", s1e3: "x" },
        null,
        "2026-09-01",
      ),
    ).toBeNull();
  });
});

describe("episodeProgress", () => {
  it("counts regular episodes against aired and listed totals", () => {
    expect(
      episodeProgress(
        { s0e1: "x", s1e1: "x", s1e2: "x" },
        { airedEpisodes: 7, numberOfEpisodes: 12 },
      ),
    ).toEqual({ watched: 2, aired: 7, total: 12 });
  });

  it("falls back to the listed total for cards without an aired count", () => {
    expect(
      episodeProgress({}, { airedEpisodes: null, numberOfEpisodes: 12 }),
    ).toEqual({ watched: 0, aired: 12, total: 12 });
  });
});
