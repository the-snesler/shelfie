import type { PersonDetail } from "@shelfie/shared";
import BetterSqlite3 from "better-sqlite3";
import { Hono } from "hono";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations.js";
import type { Database } from "../db/types.js";
import { personCredits } from "../tmdb/client.js";
import { registerPeopleRoutes } from "./routes.js";

const person: PersonDetail = {
  tmdbId: 17419,
  name: "Bryan Cranston",
  profilePath: "/p.jpg",
  biography: null,
  birthday: "1956-03-07",
  deathday: null,
  placeOfBirth: null,
  knownForDepartment: "Acting",
  imdbId: "nm0186505",
  credits: [],
};

let database: Kysely<Database>;
beforeEach(async () => {
  database = new Kysely<Database>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(":memory:") }),
  });
  await runMigrations(database);
});
afterEach(async () => {
  await database.destroy();
});

describe("GET /api/people/by-id/:id", () => {
  it("fetches once, then serves from cache", async () => {
    const fetchPerson = vi.fn(async () => person);
    const app = new Hono();
    registerPeopleRoutes(app, database, fetchPerson);

    const first = await app.request("/api/people/by-id/17419");
    const second = await app.request("/api/people/by-id/17419");
    expect(await first.json()).toEqual(person);
    expect(await second.json()).toEqual(person);
    expect(fetchPerson).toHaveBeenCalledTimes(1);
  });

  it("refetches a stale row", async () => {
    await database
      .insertInto("person_metadata")
      .values({
        tmdb_id: 17419,
        name: "Old",
        detail: JSON.stringify({ ...person, name: "Old" }),
        fetched_at: 0,
      })
      .execute();
    const app = new Hono();
    registerPeopleRoutes(app, database, async () => person);
    const res = await app.request("/api/people/by-id/17419");
    expect(((await res.json()) as PersonDetail).name).toBe("Bryan Cranston");
  });

  it("returns 400 for bad ids and 404 for unknown people", async () => {
    const app = new Hono();
    registerPeopleRoutes(app, database, async () => null);
    expect((await app.request("/api/people/by-id/abc")).status).toBe(400);
    expect((await app.request("/api/people/by-id/0")).status).toBe(400);
    expect((await app.request("/api/people/by-id/5")).status).toBe(404);
  });
});

describe("personCredits", () => {
  it("merges roles per title, drops non-roles, and sorts newest first", () => {
    const credits = personCredits([
      {
        id: 1,
        media_type: "movie",
        title: "Old Film",
        release_date: "2001-05-01",
        character: "Hero",
        poster_path: null,
        vote_count: 10,
      },
      {
        id: 2,
        media_type: "tv",
        name: "Show",
        first_air_date: "2008-01-20",
        character: "Walter",
        episode_count: 60,
        poster_path: null,
        vote_count: 99,
      },
      {
        id: 2,
        media_type: "tv",
        name: "Show",
        first_air_date: "2008-01-20",
        character: "Heisenberg",
        episode_count: 62,
        poster_path: null,
      },
      {
        id: 3,
        media_type: "tv",
        name: "Late Night",
        first_air_date: "1990-01-01",
        character: "Guest",
        genre_ids: [10767],
        poster_path: null,
      },
      {
        id: 4,
        media_type: "movie",
        title: "Awards",
        release_date: "2015-02-02",
        character: "Himself",
        poster_path: null,
      },
      {
        id: 5,
        media_type: "movie",
        title: "Upcoming",
        release_date: "",
        character: null,
        poster_path: null,
      },
    ]);
    expect(credits.map((c) => c.name)).toEqual([
      "Upcoming",
      "Show",
      "Old Film",
    ]);
    expect(credits[1]).toMatchObject({
      character: "Walter / Heisenberg",
      episodeCount: 62,
      voteCount: 99,
    });
    expect(credits[0].date).toBeNull();
  });
});
