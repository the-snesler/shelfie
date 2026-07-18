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
  progressFormat: "hours",
  progressValue: 42,
  addedAt: 1,
  updatedAt: 2,
  _deleted: false,
  platforms: ["PlayStation 5"],
  rating: 4.5,
  completedDates: ["2024-01-02"],
  notes: "great",
};

const wishlistedSample: ReplicatedLibraryItem = {
  ...sample,
  id: "game:7",
  sourceId: "7",
  status: "wishlisted",
  progressFormat: "hours",
  progressValue: null,
  platforms: [],
  rating: null,
  completedDates: [],
  notes: "",
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

  it("is at schema version 3 with platforms/rating/completions/notes/progress-format migrations", () => {
    expect(libraryItemSchema.version).toBe(3);
    expect(Object.keys(libraryItemMigrationStrategies)).toContain("1");
    expect(Object.keys(libraryItemMigrationStrategies)).toContain("2");
    expect(Object.keys(libraryItemMigrationStrategies)).toContain("3");
    const migrate1 = libraryItemMigrationStrategies[1] as (
      oldDoc: unknown,
    ) => unknown;
    expect(migrate1({ id: "game:1", platforms: undefined })).toMatchObject({
      platforms: [],
    });
    const migrate2 = libraryItemMigrationStrategies[2] as (
      oldDoc: unknown,
    ) => unknown;
    expect(migrate2({ id: "game:1" })).toMatchObject({
      rating: null,
      completedDates: [],
      notes: "",
    });
    const migrate3 = libraryItemMigrationStrategies[3] as (
      oldDoc: unknown,
    ) => unknown;
    expect(migrate3({ id: "game:1", progress: 42 })).toEqual({
      id: "game:1",
      progressFormat: "percent",
      progressValue: 42,
    });
    expect(migrate3({ id: "game:1", progress: null })).toEqual({
      id: "game:1",
      progressFormat: "percent",
      progressValue: null,
    });
  });

  it("keeps status a plain string in the RxDB schema (enum lives in zod)", () => {
    expect(libraryItemSchema.properties.status.type).toBe("string");
    expect(libraryItemSchema.properties.status).not.toHaveProperty("enum");
  });

  it("allows progressValue to be null or absent-typed as number|null, and progressFormat as a plain string, in the RxDB schema", () => {
    expect(libraryItemSchema.properties.progressValue.type).toEqual([
      "number",
      "null",
    ]);
    expect(libraryItemSchema.properties.progressFormat.type).toBe("string");
  });
});
