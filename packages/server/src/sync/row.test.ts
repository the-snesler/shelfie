import { describe, expect, it } from "vitest";
import type { ReplicatedLibraryItem } from "@shelfie/shared";
import { libraryItemDocToRow, libraryItemRowToDoc } from "./row.js";

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
  _deleted: false,
};

describe("libraryItemDocToRow / libraryItemRowToDoc", () => {
  it("round-trips a fully-populated document", () => {
    const doc: ReplicatedLibraryItem = {
      ...base,
      platforms: ["PC", "Switch"],
      rating: 4.5,
      completedDates: ["2024-01-01", "2025-06-30"],
      notes: "great",
      watchedEpisodes: { s1e1: "2024-01-01", s1e2: "2024-01-02", s0e1: "2024-01-03" },
    };
    expect(libraryItemRowToDoc(libraryItemDocToRow(doc, 7))).toEqual(doc);
  });

  it("round-trips the minimal document", () => {
    expect(libraryItemRowToDoc(libraryItemDocToRow(base, 1))).toEqual(base);
  });

  it("maps _deleted to the row's deleted flag and back", () => {
    const deleted = { ...base, _deleted: true };
    const deletedRow = libraryItemDocToRow(deleted, 1);
    expect(deletedRow.deleted).toBe(1);
    expect(libraryItemRowToDoc(deletedRow)._deleted).toBe(true);

    const active = { ...base, _deleted: false };
    const activeRow = libraryItemDocToRow(active, 1);
    expect(activeRow.deleted).toBe(0);
    expect(libraryItemRowToDoc(activeRow)._deleted).toBe(false);
  });

  it("stores seq on the row and serializes array fields as JSON", () => {
    const doc: ReplicatedLibraryItem = {
      ...base,
      platforms: ["PC", "Switch"],
      completedDates: ["2024-01-01"],
      watchedEpisodes: { s1e1: "2024-01-01", s1e2: "2024-01-02", s0e1: "2024-01-03" },
    };
    const row = libraryItemDocToRow(doc, 42);
    expect(row.seq).toBe(42);
    expect(JSON.parse(row.platforms)).toEqual(doc.platforms);
    expect(JSON.parse(row.completed_dates)).toEqual(doc.completedDates);
    expect(JSON.parse(row.watched_episodes)).toEqual(doc.watchedEpisodes);
  });
});
