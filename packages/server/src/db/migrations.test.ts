import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  libraryItemMigrationStrategies,
  type ReplicatedLibraryItem,
} from "@tsundo/shared";
import { libraryItemRowToDoc } from "../sync/row.js";
import { runMigrations } from "./migrations.js";
import type { Database } from "./types.js";

let database: Kysely<Database>;

beforeEach(() => {
  database = new Kysely<Database>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
  });
});

afterEach(async () => {
  await database.destroy();
});

describe("movie-book-release-dates migration", () => {
  it("expires year-only movie cards and keeps book publication dates", async () => {
    await runMigrations(database, 12);
    await sql`INSERT INTO movie_metadata (tmdb_id, name, year, fetched_at, detail_fetched_at) VALUES (1, 'Movie', 2024, 500, 400)`.execute(
      database,
    );
    await sql`INSERT INTO book_metadata (goodreads_id, name, year, publication_date, fetched_at) VALUES (2, 'Book', 1999, '1999-04-01', 500)`.execute(
      database,
    );

    await runMigrations(database, 13);

    expect(
      await database
        .selectFrom("movie_metadata")
        .select(["release_date", "fetched_at", "detail_fetched_at"])
        .executeTakeFirstOrThrow(),
    ).toEqual({ release_date: null, fetched_at: 0, detail_fetched_at: 400 });
    expect(
      await database
        .selectFrom("book_metadata")
        .select(["publication_date", "fetched_at"])
        .executeTakeFirstOrThrow(),
    ).toEqual({ publication_date: "1999-04-01", fetched_at: 500 });
  });
});

describe("tv-first-air-date migration", () => {
  it("adds the column and expires both cached tiers", async () => {
    await runMigrations(database, 15);
    await sql`INSERT INTO tv_metadata (tmdb_id, name, first_air_year, fetched_at, detail_fetched_at) VALUES (1, 'Detailed', 2024, 500, 400), (2, 'Card only', 2025, 500, NULL)`.execute(
      database,
    );

    await runMigrations(database, 17);

    expect(
      await database
        .selectFrom("tv_metadata")
        .select([
          "tmdb_id",
          "first_air_date",
          "fetched_at",
          "detail_fetched_at",
        ])
        .orderBy("tmdb_id")
        .execute(),
    ).toEqual([
      { tmdb_id: 1, first_air_date: null, fetched_at: 0, detail_fetched_at: 0 },
      {
        tmdb_id: 2,
        first_air_date: null,
        fetched_at: 0,
        detail_fetched_at: null,
      },
    ]);
  });
});

describe("person-metadata migration", () => {
  it("creates the cache and expires only the detail tier", async () => {
    await runMigrations(database, 23);
    await sql`INSERT INTO movie_metadata (tmdb_id, name, fetched_at, detail_fetched_at) VALUES (1, 'Movie', 500, 400)`.execute(
      database,
    );
    await sql`INSERT INTO tv_metadata (tmdb_id, name, fetched_at, detail_fetched_at) VALUES (2, 'Show', 500, 400)`.execute(
      database,
    );

    await runMigrations(database, 24);

    for (const table of ["movie_metadata", "tv_metadata"] as const) {
      expect(
        await database
          .selectFrom(table)
          .select(["fetched_at", "detail_fetched_at"])
          .executeTakeFirstOrThrow(),
      ).toEqual({ fetched_at: 500, detail_fetched_at: null });
    }
    expect(
      await database.selectFrom("person_metadata").selectAll().execute(),
    ).toEqual([]);
  });
});

describe("library-item-completion-moments migration", () => {
  it("renames completed_dates in the column and in activity, as the client does", async () => {
    await runMigrations(database, 26);
    const activity = [
      {
        id: "a",
        at: 1,
        changes: { status: "finished", completedDates: ["2024-01-02"] },
      },
      { id: "b", at: 2, changes: { rating: 4 } },
    ];
    await sql`INSERT INTO library_items (id, media_type, source_id, status, progress_format, progress_value, added_at, updated_at, platforms, rating, excitement, storefront, completed_dates, notes, watched_episodes, activity, seq, deleted)
      VALUES ('movie:1', 'movie', '1', 'finished', 'percent', NULL, 1, 5, '[]', 4, NULL, NULL, '["2024-01-02"]', '', '{}', ${JSON.stringify(activity)}, 7, 0)`.execute(
      database,
    );

    await runMigrations(database, 27);

    const row = await database
      .selectFrom("library_items")
      .selectAll()
      .executeTakeFirstOrThrow();
    // A value remap, not a write: replication state is untouched.
    expect(row).toMatchObject({ seq: 7, updated_at: 5 });
    const { _deleted, ...doc } = libraryItemRowToDoc(row);
    expect(_deleted).toBe(false);
    expect(doc.completions).toEqual(["2024-01-02"]);
    // Same document the client's RxDB migration 10 produces from v9.
    const legacy = {
      ...doc,
      completions: undefined,
      completedDates: ["2024-01-02"],
      activity,
    };
    delete legacy.completions;
    expect(libraryItemMigrationStrategies[10](legacy, null as never)).toEqual(
      doc satisfies Omit<ReplicatedLibraryItem, "_deleted">,
    );
  });
});
