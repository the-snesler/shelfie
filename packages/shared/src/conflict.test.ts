import { describe, expect, it } from "vitest";
import { libraryItemConflictHandler } from "./index.js";
import type { ReplicatedLibraryItem } from "./types.js";

const base: ReplicatedLibraryItem = {
  id: "game:1942",
  mediaType: "game",
  sourceId: "1942",
  status: "active",
  progressFormat: "hours",
  progressValue: 10,
  addedAt: 1,
  updatedAt: 10,
  platforms: [],
  rating: null,
  completedDates: [],
  notes: "",
  watchedEpisodes: {},
  activity: [],
  _deleted: false,
};

describe("libraryItemConflictHandler", () => {
  it("detects equal replicated library item states", () => {
    expect(libraryItemConflictHandler.isEqual(base, { ...base }, "test")).toBe(
      true,
    );
    expect(
      libraryItemConflictHandler.isEqual(
        base,
        { ...base, progressValue: 20 },
        "test",
      ),
    ).toBe(false);
  });

  it("resolves to the newer local document", async () => {
    const local = { ...base, progressValue: 50, updatedAt: 20 };
    await expect(
      libraryItemConflictHandler.resolve(
        { realMasterState: base, newDocumentState: local },
        "test",
      ),
    ).resolves.toEqual(local);
  });

  it("resolves to the newer remote document", async () => {
    const remote = { ...base, progressValue: 50, updatedAt: 20 };
    await expect(
      libraryItemConflictHandler.resolve(
        { realMasterState: remote, newDocumentState: base },
        "test",
      ),
    ).resolves.toEqual(remote);
  });

  it("prefers deletion when timestamps tie", async () => {
    const deleted = { ...base, _deleted: true };
    await expect(
      libraryItemConflictHandler.resolve(
        { realMasterState: base, newDocumentState: deleted },
        "test",
      ),
    ).resolves.toEqual(deleted);
  });
  it("preserves and deduplicates both devices' history while current values use LWW", async () => {
    const shared = {
      id: "shared",
      at: 1,
      changes: { status: "active" as const },
    };
    const local = {
      ...base,
      updatedAt: 20,
      activity: [
        shared,
        { id: "local", at: 3, changes: { progressValue: 50 } },
      ],
    };
    const remote = {
      ...base,
      updatedAt: 30,
      activity: [shared, { id: "remote", at: 2, changes: { rating: 4 } }],
    };
    const input = { realMasterState: remote, newDocumentState: local };
    const merged = await libraryItemConflictHandler.resolve(input, "test");
    expect(merged.progressValue).toBe(remote.progressValue);
    expect(merged.activity.map((event) => event.id)).toEqual([
      "shared",
      "remote",
      "local",
    ]);
    expect(
      await libraryItemConflictHandler.resolve(
        { realMasterState: local, newDocumentState: remote },
        "test",
      ),
    ).toEqual(merged);
    expect(
      await libraryItemConflictHandler.resolve(
        { realMasterState: merged, newDocumentState: local },
        "test",
      ),
    ).toEqual(merged);
  });

  it("treats docs differing only in watchedEpisodes as unequal", () => {
    const withEpisode = { ...base, watchedEpisodes: { s1e1: "2024-01-01" } };
    expect(libraryItemConflictHandler.isEqual(withEpisode, base, "test")).toBe(
      false,
    );
  });

  it("treats watchedEpisodes maps as equal regardless of key insertion order", () => {
    const a = {
      ...base,
      watchedEpisodes: { s1e1: "2024-01-01", s1e2: "2024-01-02" },
    };
    const b = {
      ...base,
      watchedEpisodes: { s1e2: "2024-01-02", s1e1: "2024-01-01" },
    };
    expect(libraryItemConflictHandler.isEqual(a, b, "test")).toBe(true);
  });
});
