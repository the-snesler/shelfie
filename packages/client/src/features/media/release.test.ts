import type { LibraryItem } from "@shelfie/shared";
import { describe, expect, it } from "vitest";
import type { GameCardDoc } from "../../db/gameCards";
import type { MovieCardDoc } from "../../db/movieCards";
import type { TvCardDoc } from "../../db/tvCards";
import { itemReleaseDate, releaseState } from "./release";

const epoch = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;
const noPlatforms: Pick<LibraryItem, "platforms"> = { platforms: [] };

const game = {
  id: "game:1",
  firstReleaseDate: epoch("2026-03-01"),
  platformReleaseDates: [
    { platform: "PC (Microsoft Windows)", date: epoch("2026-03-01") },
    { platform: "PlayStation 5", date: epoch("2027-02-10") },
  ],
} as GameCardDoc;

describe("release state", () => {
  it("compares release days against the viewer's local today", () => {
    const movie = { id: "movie:1", releaseDate: "2026-11-07" } as MovieCardDoc;
    expect(releaseState(noPlatforms, movie, "2026-11-06")).toEqual({
      kind: "upcoming",
      date: "2026-11-07",
    });
    expect(releaseState(noPlatforms, movie, "2026-11-07")).toEqual({
      kind: "released",
    });
  });

  it("uses the platforms a game is logged on, else its first release", () => {
    expect(itemReleaseDate(noPlatforms, game)).toBe("2026-03-01");
    expect(itemReleaseDate({ platforms: ["PlayStation 5"] }, game)).toBe(
      "2027-02-10",
    );
    expect(
      itemReleaseDate(
        { platforms: ["PlayStation 5", "PC (Microsoft Windows)"] },
        game,
      ),
    ).toBe("2026-03-01");
    // A platform with no dated release falls back rather than guessing.
    expect(itemReleaseDate({ platforms: ["Nintendo Switch"] }, game)).toBe(
      "2026-03-01",
    );
  });

  it("treats a dateless show as TBA only when TMDB says it hasn't aired", () => {
    const show = (status: string | null) =>
      ({
        id: "tv:1",
        firstAirDate: null,
        firstAirYear: null,
        status,
        numberOfEpisodes: 0,
      }) as TvCardDoc;
    expect(
      releaseState(noPlatforms, show("In Production"), "2026-11-06"),
    ).toEqual({ kind: "tba" });
    expect(
      releaseState(noPlatforms, show("Returning Series"), "2026-11-06"),
    ).toEqual({ kind: "released" });
  });

  it("never files a title away when its metadata is missing", () => {
    expect(releaseState(noPlatforms, undefined, "2026-11-06")).toEqual({
      kind: "released",
    });
    expect(
      releaseState(
        noPlatforms,
        { id: "movie:2", releaseDate: null } as MovieCardDoc,
        "2026-11-06",
      ),
    ).toEqual({ kind: "released" });
  });
});
