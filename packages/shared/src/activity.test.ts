import { describe, expect, it } from "vitest";
import type { LibraryItem } from "./types.js";
import { recordItemActivity } from "./activity.js";

const base: LibraryItem = {
  id: "game:1",
  sourceId: "1",
  mediaType: "game",
  status: "active",
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
};

describe("recordItemActivity", () => {
  it("records progress with its unit and completion with the logging timestamp", () => {
    const progress = { ...base, progressValue: 50 };
    recordItemActivity(progress, base, 100, "progress");
    expect(progress.activity).toEqual([
      {
        id: "progress",
        at: 100,
        changes: { progressFormat: "percent", progressValue: 50 },
      },
    ]);
    const completed = {
      ...progress,
      status: "finished" as const,
      completedDates: ["2020-01-01"],
    };
    recordItemActivity(completed, progress, 200, "completion");
    expect(completed.activity[1]).toEqual({
      id: "completion",
      at: 200,
      changes: { status: "finished", completedDates: ["2020-01-01"] },
    });
    expect(base.activity).toEqual([]);
  });
  it("records only changed episode keys, including unwatches", () => {
    const previous = {
      ...base,
      watchedEpisodes: { s1e1: "2026-01-01", s1e2: "2026-01-02" },
    };
    const next = {
      ...base,
      watchedEpisodes: { s1e2: "2026-01-02", s1e3: "2026-01-03" },
    };
    recordItemActivity(next, previous, 100, "episodes");
    expect(next.activity[0]?.changes).toEqual({
      watchedEpisodes: { s1e1: null, s1e3: "2026-01-03" },
    });
  });
  it("does not invent events for timestamp-only writes or unchanged values", () => {
    const next = { ...base, updatedAt: 200 };
    recordItemActivity(next, base, 200, "noop");
    expect(next.activity).toEqual([]);
  });
  it("keeps explicit repeat completions without duplicating their event", () => {
    const previous = {
      ...base,
      status: "finished" as const,
      completedDates: ["2026-01-01"],
    };
    const event = {
      id: "repeat",
      at: 200,
      changes: { status: "finished" as const, completedDates: ["2026-01-01"] },
    };
    const next = { ...previous, activity: [event] };
    recordItemActivity(next, previous, 200, "automatic");
    expect(next.activity).toEqual([event]);
    const withNotes = {
      ...previous,
      notes: "Finished again",
      activity: [event],
    };
    recordItemActivity(withNotes, previous, 200, "notes");
    expect(
      withNotes.activity.find((entry) => entry.id === "notes")?.changes,
    ).toEqual({ notes: "Finished again" });
  });
  it("records the initial status without logging empty defaults", () => {
    const next = { ...base };
    recordItemActivity(next, undefined, 100, "added");
    expect(next.activity[0]?.changes).toEqual({ status: "active" });
  });
});
