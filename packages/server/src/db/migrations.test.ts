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

    await runMigrations(database);

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
