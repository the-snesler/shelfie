import type { LibraryItem, TvScheduledEpisode } from "@shelfie/shared";
import { describe, expect, it } from "vitest";
import type { CardMeta } from "../media/useLibraryData";
import { addDays, monthGrid, shiftMonth } from "./calendarDates";
import { buildCalendarEvents, episodeLabel } from "./calendarEvents";

function libraryItem(overrides: Partial<LibraryItem>): LibraryItem {
  return {
    id: "game:1",
    mediaType: "game",
    sourceId: "1",
    status: "wishlisted",
    progressFormat: "hours",
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

function episode(
  airDate: string,
  seasonNumber: number,
  episodeNumber: number,
): TvScheduledEpisode {
  return {
    tmdbId: 9,
    seasonNumber,
    episodeNumber,
    name: `Ep ${episodeNumber}`,
    airDate,
    stillPath: null,
  };
}

describe("calendarDates", () => {
  it("builds Sunday-first weeks covering the month", () => {
    const days = monthGrid("2026-10"); // Oct 1 2026 is a Thursday
    expect(days[0]).toBe("2026-09-27");
    expect(days[days.length - 1]).toBe("2026-10-31");
    expect(days.length % 7).toBe(0);
  });

  it("crosses month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});

describe("episodeLabel", () => {
  it("formats single, contiguous, and scattered episodes", () => {
    expect(episodeLabel(2, [3])).toBe("S2E3");
    expect(episodeLabel(2, [1, 2, 3, 4])).toBe("S2E1–4");
    expect(episodeLabel(2, [1, 4])).toBe("S2 · 2 episodes");
  });
});

describe("buildCalendarEvents", () => {
  const game = libraryItem({
    completedDates: ["2026-10-02"],
  });
  const show = libraryItem({
    id: "tv:9",
    mediaType: "tv",
    sourceId: "9",
    status: "active",
  });
  const cards = new Map<string, CardMeta>([
    [
      "game:1",
      {
        name: "Game",
        firstReleaseDate: Date.UTC(2026, 9, 20) / 1000,
      } as unknown as CardMeta,
    ],
    [
      "tv:9",
      {
        name: "Show",
        nextEpisodeToAir: {
          seasonNumber: 3,
          episodeNumber: 1,
          name: "Premiere",
          airDate: "2026-11-01",
          stillPath: null,
        },
      } as unknown as CardMeta,
    ],
  ]);

  it("collects completions, game releases, and grouped episode drops", () => {
    const events = buildCalendarEvents([game, show], cards, [
      episode("2026-10-09", 2, 1),
      episode("2026-10-09", 2, 2),
    ]);
    expect(events.map((e) => [e.kind, e.date])).toEqual([
      ["completion", "2026-10-02"],
      ["episodes", "2026-10-09"],
      ["release", "2026-10-20"],
      ["episodes", "2026-11-01"], // card fallback: not in the schedule
    ]);
    const drop = events[1];
    expect(drop.kind === "episodes" && drop.episodes).toEqual([1, 2]);
    expect(drop.kind === "episodes" && drop.name).toBe(null);
  });

  it("dedupes the card's next episode against the schedule", () => {
    const events = buildCalendarEvents([show], cards, [
      episode("2026-11-01", 3, 1),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].kind === "episodes" && events[0].name).toBe("Ep 1");
  });

  it("keeps a dropped item's history but none of its releases", () => {
    const events = buildCalendarEvents(
      [
        { ...game, status: "dropped" },
        { ...show, status: "dropped" },
      ],
      cards,
      [episode("2026-10-09", 2, 1)],
    );
    expect(events.map((e) => e.kind)).toEqual(["completion"]);
  });
});
