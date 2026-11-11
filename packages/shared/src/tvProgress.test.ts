import { describe, expect, it } from "vitest";
import type { TvAiring, TvLastAiring } from "./tv.js";
import {
  tvFinishedDay,
  tvWatchState,
  type TvProgressCard,
} from "./tvProgress.js";

const airing = (episodeNumber: number, airDate: string): TvAiring => ({
  seasonNumber: 1,
  episodeNumber,
  name: `Episode ${episodeNumber}`,
  airDate,
  stillPath: null,
});
const last = (
  episodeType: string | null,
  airDate = "2026-11-01",
): TvLastAiring => ({ ...airing(2, airDate), episodeType });
const card = (
  lastEpisodeToAir: TvLastAiring | null,
  next: TvAiring | null = null,
): TvProgressCard => ({
  lastEpisodeToAir,
  airedEpisodes: lastEpisodeToAir ? 2 : null,
  nextEpisodeToAir: next,
});
const both = { s1e1: "2026-10-25", s1e2: "2026-11-02" };
const TODAY = "2026-11-11";

describe("tvWatchState", () => {
  it("is unknown without a card or before anything airs", () => {
    expect(tvWatchState(both, undefined, TODAY)).toBeNull();
    expect(tvWatchState(both, card(null), TODAY)).toBeNull();
  });
  it("is behind while an aired regular episode is unwatched, specials aside", () => {
    expect(
      tvWatchState(
        { s1e1: "2026-10-25", s0e1: "2026-10-26" },
        card(last("finale")),
        TODAY,
      ),
    ).toBe("behind");
  });
  it("ends the season at a finale, even with the next season scheduled", () => {
    expect(tvWatchState(both, card(last("finale")), TODAY)).toBe("season-over");
    expect(
      tvWatchState(both, card(last("finale"), airing(3, "2026-12-09")), TODAY),
    ).toBe("season-over");
  });
  it("ends a mid-season break only when nothing is scheduled", () => {
    expect(tvWatchState(both, card(last("mid_season")), TODAY)).toBe(
      "season-over",
    );
    expect(
      tvWatchState(
        both,
        card(last("mid_season"), airing(3, "2027-01-05")),
        TODAY,
      ),
    ).toBe("caught-up");
  });
  it("waits for the next scheduled episode", () => {
    expect(
      tvWatchState(
        both,
        card(last("standard"), airing(3, "2026-11-08")),
        TODAY,
      ),
    ).toBe("caught-up");
  });
  it("calls an untagged, unscheduled season over after the grace period", () => {
    expect(
      tvWatchState(both, card(last("standard", "2026-10-13")), TODAY),
    ).toBe("caught-up");
    expect(
      tvWatchState(both, card(last("standard", "2026-10-12")), TODAY),
    ).toBe("season-over");
    expect(tvWatchState(both, card(last(null, "2026-01-01")), TODAY)).toBe(
      "season-over",
    );
  });
});

describe("tvFinishedDay", () => {
  it("prefers the latest aired episode's watch day", () => {
    expect(
      tvFinishedDay({ ...both, s1e1: "2026-12-01" }, card(last("finale"))),
    ).toBe("2026-11-02");
  });
  it("falls back to the latest known regular watch day, else null", () => {
    expect(
      tvFinishedDay(
        { s1e1: "2026-10-25", s1e2: "", s0e1: "2026-12-25" },
        card(last("finale")),
      ),
    ).toBe("2026-10-25");
    expect(tvFinishedDay({ s1e1: "", s1e2: "" }, card(last("finale")))).toBe(
      null,
    );
  });
});
