import { describe, expect, it } from "vitest";
import type { LibraryItem } from "@shelfie/shared";
import {
  exportLibraryCsv,
  importLibraryCsv,
  prepareLibraryImport,
} from "./libraryCsv";

const item: LibraryItem = {
  id: "book:42",
  mediaType: "book",
  sourceId: "42",
  status: "active",
  progressFormat: "pages",
  progressValue: 12,
  platforms: [],
  rating: 4.5,
  completedDates: ["2026-01-02"],
  notes: 'A note, with "quotes"\nand a newline.',
  watchedEpisodes: {},
  addedAt: 100,
  updatedAt: 200,
};

describe("library CSV", () => {
  it("round-trips quoted cells, JSON fields, and nullable numbers", () => {
    const withoutNumbers = { ...item, progressValue: null, rating: null };
    const [parsed] = importLibraryCsv(exportLibraryCsv([withoutNumbers]));

    expect(parsed).toEqual({ ...withoutNumbers, updatedAt: 1 });
  });

  it("rejects duplicate and inconsistent ids before import", () => {
    const csv = exportLibraryCsv([item]);
    const dataRow = csv.split("\r\n")[1];
    expect(() => importLibraryCsv(`${csv}\r\n${dataRow}`)).toThrow(
      "duplicate id",
    );
    expect(() => importLibraryCsv(csv.replace("book:42", "book:99"))).toThrow(
      "does not match",
    );
  });

  it("overwrites existing values, preserves the earliest added date, and refreshes updatedAt", () => {
    const current = { ...item, notes: "current", addedAt: 50 };
    const prepared = prepareLibraryImport(
      [{ ...item, notes: "imported", addedAt: 100 }],
      new Map([[item.id, current]]),
      999,
    );

    expect(prepared).toMatchObject({ added: 0, updated: 1 });
    expect(prepared.documents[0]).toMatchObject({
      notes: "imported",
      addedAt: 50,
      updatedAt: 999,
    });
  });
});
