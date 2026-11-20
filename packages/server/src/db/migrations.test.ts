import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    await runMigrations(database, 22);
    await sql`INSERT INTO movie_metadata (tmdb_id, name, fetched_at, detail_fetched_at) VALUES (1, 'Movie', 500, 400)`.execute(
      database,
    );
    await sql`INSERT INTO tv_metadata (tmdb_id, name, fetched_at, detail_fetched_at) VALUES (2, 'Show', 500, 400)`.execute(
      database,
    );

    await runMigrations(database, 23);

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
