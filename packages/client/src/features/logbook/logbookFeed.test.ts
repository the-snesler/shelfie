import { describe, expect, it } from "vitest";
import {
  episodeRangeLabel,
  feedRows,
  groupEpisodes,
  type LogEntry,
} from "./logbookFeed";

const show = { id: "tv:1" };
const other = { id: "tv:2" };
const movie = { id: "movie:9" };

function ep(
  item: { id: string },
  date: string,
  season: number,
  episode: number,
): LogEntry<{ id: string }> {
  return { kind: "episode", date, item, season, episode };
}

describe("episodeRangeLabel", () => {
  it("labels a single episode", () => {
    expect(episodeRangeLabel([{ season: 1, episode: 3 }])).toBe("S1E3");
  });

  it("labels an unbroken run within a season as a range", () => {
    expect(
      episodeRangeLabel([
        { season: 2, episode: 4 },
        { season: 2, episode: 5 },
        { season: 2, episode: 6 },
      ]),
    ).toBe("S2E4–E6");
  });

  it("adds a count when the run has gaps", () => {
    expect(
      episodeRangeLabel([
        { season: 1, episode: 1 },
        { season: 1, episode: 4 },
      ]),
    ).toBe("S1E1–E4 · 2 eps");
  });

  it("names both seasons and counts when the run crosses seasons", () => {
    expect(
      episodeRangeLabel([
        { season: 1, episode: 12 },
        { season: 2, episode: 1 },
      ]),
    ).toBe("S1E12–S2E1 · 2 eps");
  });
});

describe("groupEpisodes", () => {
  it("collapses one show's episodes per day, sorted, at its first position", () => {
    const grouped = groupEpisodes([
      { kind: "completion", date: "2026-03-02", item: movie },
      ep(show, "2026-03-02", 1, 3),
      ep(other, "2026-03-02", 4, 1),
      ep(show, "2026-03-02", 1, 1),
      ep(show, "2026-03-02", 1, 2),
      ep(show, "2026-03-01", 1, 0),
    ]);
    expect(
      grouped.map((e) =>
        e.kind === "episodes" ? `${e.date} ${e.item.id} ${e.label}` : e.kind,
      ),
    ).toEqual([
      "completion",
      "2026-03-02 tv:1 S1E1–E3",
      "2026-03-02 tv:2 S4E1",
      "2026-03-01 tv:1 S1E0",
    ]);
  });

  it("keeps the same show on different days apart", () => {
    const grouped = groupEpisodes([
      ep(show, "2026-03-02", 1, 2),
      ep(show, "2026-03-01", 1, 1),
    ]);
    expect(grouped).toHaveLength(2);
  });
});

describe("feedRows", () => {
  it("interleaves month headers with unique, stable keys", () => {
    const rows = feedRows([
      { kind: "completion", date: "2026-03-02", item: movie },
      { kind: "completion", date: "2026-03-02", item: movie },
      ep(show, "2026-03-02", 1, 1),
      ep(show, "2026-03-02", 1, 2),
      ep(show, "2026-02-27", 1, 3),
    ]);
    expect(rows.map((row) => row.key)).toEqual([
      "month:2026-03",
      "completion:movie:9:2026-03-02",
      "completion:movie:9:2026-03-02:1",
      "episodes:tv:1:2026-03-02",
      "month:2026-02",
      "episodes:tv:1:2026-02-27",
    ]);
    expect(
      rows.filter((row) => row.kind === "month").map((row) => row.first),
    ).toEqual([true, false]);
  });
});
