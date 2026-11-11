import type { TvLastAiring } from "@shelfie/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TvCardDoc } from "../../db/tvCards";
import { findList, listMembers } from "../lists/automaticLists";
import { isCaughtUp } from "./caughtUp";
import { deriveEpisodeWatch } from "./libraryActions";

const TODAY = "2026-11-11";
const last = (episodeType: string, airDate = "2026-11-05"): TvLastAiring => ({
  seasonNumber: 1,
  episodeNumber: 2,
  name: "",
  airDate,
  stillPath: null,
  episodeType,
});
const card = (
  lastEpisodeToAir: TvLastAiring | null,
  scheduled = false,
): TvCardDoc => ({
  id: "tv:1",
  tmdbId: 1,
  name: "Show",
  posterPath: null,
  genres: [],
  firstAirYear: 2026,
  firstAirDate: "2026-10-01",
  status: "Returning Series",
  numberOfSeasons: 1,
  numberOfEpisodes: 8,
  nextEpisodeToAir: scheduled
    ? {
        seasonNumber: 1,
        episodeNumber: 3,
        name: "",
        airDate: "2026-11-12",
        stillPath: null,
      }
    : null,
  lastEpisodeToAir,
  airedEpisodes: lastEpisodeToAir ? 2 : null,
});
const both = { s1e1: "2026-10-29", s1e2: "2026-11-06" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("deriveEpisodeWatch", () => {
  const start = {
    watchedEpisodes: { s1e1: "2026-10-29" },
    status: "active" as const,
    completedDates: [],
  };
  const watchSecond = (current: Record<string, string>) => ({
    ...current,
    s1e2: TODAY,
  });

  it("finishes the show at the season finale", () => {
    expect(
      deriveEpisodeWatch(start, card(last("finale")), watchSecond),
    ).toMatchObject({ status: "finished", completedDates: [TODAY] });
  });
  it("stays watching when caught up on a show still airing", () => {
    expect(
      deriveEpisodeWatch(start, card(last("standard"), true), watchSecond)
        .status,
    ).toBe("active");
    // Including one marked Watched mid-season.
    expect(
      deriveEpisodeWatch(
        { ...start, status: "finished" },
        card(last("standard"), true),
        watchSecond,
      ).status,
    ).toBe("active");
  });
  it("falls back to every listed episode for cards cached before progress fields", () => {
    const old = { ...card(null), numberOfEpisodes: 2 };
    expect(deriveEpisodeWatch(start, old, watchSecond).status).toBe("finished");
  });
});

describe("caught-up shows", () => {
  const item = {
    id: "tv:1",
    mediaType: "tv" as const,
    status: "active" as const,
    watchedEpisodes: both,
  };
  it("are active shows with every aired episode watched, more to come", () => {
    expect(isCaughtUp(item, card(last("standard"), true), TODAY)).toBe(true);
    expect(isCaughtUp(item, card(last("finale")), TODAY)).toBe(false);
    expect(
      isCaughtUp(
        { ...item, watchedEpisodes: { s1e1: "2026-10-29" } },
        card(last("standard"), true),
        TODAY,
      ),
    ).toBe(false);
    expect(
      isCaughtUp(
        { ...item, status: "paused" },
        card(last("standard"), true),
        TODAY,
      ),
    ).toBe(false);
    // No card yet: unknown, so not hidden.
    expect(isCaughtUp(item, undefined, TODAY)).toBe(false);
  });
  it("make up the Caught up list", () => {
    const list = findList("caught-up")!;
    const ctx = { now: Date.now(), today: TODAY };
    const doc = { ...item, sourceId: "1" } as never;
    expect(
      listMembers(list, [doc], null, {
        ...ctx,
        cards: new Map([["tv:1", card(last("standard"), true)]]),
      }),
    ).toHaveLength(1);
    expect(listMembers(list, [doc], null, ctx)).toHaveLength(0);
  });
});
