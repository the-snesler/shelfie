import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  libraryItemDocSchema,
  libraryItemMigrationStrategies,
  libraryItemSchema,
} from "./index.js";
import type { ReplicatedLibraryItem } from "./types.js";

const sample: ReplicatedLibraryItem = {
  id: "game:1942",
  mediaType: "game",
  sourceId: "1942",
  status: "playing",
  progress: 42,
  addedAt: 1,
  updatedAt: 2,
  _deleted: false,
};

const wishlistedSample: ReplicatedLibraryItem = {
  ...sample,
  id: "game:7",
  sourceId: "7",
  status: "wishlisted",
  progress: null,
};

describe("library item contract", () => {
  it("keeps the RxDB schema and zod validator aligned", () => {
    const zodShape = (
      libraryItemDocSchema as unknown as z.ZodObject<z.ZodRawShape>
    ).shape;
    const zodFields = Object.keys(zodShape);
    const rxFields = Object.keys(libraryItemSchema.properties);
    const rxRequired = [...(libraryItemSchema.required ?? [])];

    for (const field of zodFields.filter((field) => field !== "_deleted")) {
      expect(rxFields).toContain(field);
    }

    for (const field of rxRequired) {
      expect(zodFields).toContain(field);
    }

    expect(zodFields).toContain("_deleted");
    expect(rxFields).not.toContain("_deleted");
    expect(libraryItemDocSchema.parse(sample)).toEqual(sample);
    expect(libraryItemDocSchema.parse(wishlistedSample)).toEqual(
      wishlistedSample,
    );
  });

  it("starts at schema version 0 with an empty migration seam", () => {
    expect(libraryItemSchema.version).toBe(0);
    expect(libraryItemMigrationStrategies).toEqual({});
  });

  it("keeps status a plain string in the RxDB schema (enum lives in zod)", () => {
    expect(libraryItemSchema.properties.status.type).toBe("string");
    expect(libraryItemSchema.properties.status).not.toHaveProperty("enum");
  });

  it("allows progress to be null or absent-typed as number|null in the RxDB schema", () => {
    expect(libraryItemSchema.properties.progress.type).toEqual([
      "number",
      "null",
    ]);
  });
});
