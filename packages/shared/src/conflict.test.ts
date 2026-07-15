import { describe, expect, it } from "vitest";
import { libraryItemConflictHandler } from "./index.js";
import type { ReplicatedLibraryItem } from "./types.js";

const base: ReplicatedLibraryItem = {
  id: "game:1942",
  mediaType: "game",
  sourceId: "1942",
  status: "playing",
  progress: 10,
  addedAt: 1,
  updatedAt: 10,
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
        { ...base, progress: 20 },
        "test",
      ),
    ).toBe(false);
  });

  it("resolves to the newer local document", async () => {
    const local = { ...base, progress: 50, updatedAt: 20 };
    await expect(
      libraryItemConflictHandler.resolve(
        { realMasterState: base, newDocumentState: local },
        "test",
      ),
    ).resolves.toEqual(local);
  });

  it("resolves to the newer remote document", async () => {
    const remote = { ...base, progress: 50, updatedAt: 20 };
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
});
