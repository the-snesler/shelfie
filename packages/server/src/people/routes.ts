import type { PersonDetail } from "@shelfie/shared";
import type { Hono } from "hono";
import type { Kysely } from "kysely";
import { db as defaultDb } from "../db/index.js";
import type { Database } from "../db/types.js";
import { METADATA_TTL_MS } from "../metadata/freshness.js";
import { fetchPersonDetail } from "../tmdb/client.js";

type FetchPerson = (id: number) => Promise<PersonDetail | null>;

/**
 * `GET /api/people/by-id/:id` — a TMDB person with their acting credits,
 * cache-first against `person_metadata` with the shared metadata TTL.
 * People have no card tier, search, or release dates, so this skips the
 * generic `registerMetadataRoutes` machinery.
 */
export function registerPeopleRoutes(
  app: Hono,
  database: Kysely<Database> = defaultDb,
  fetchPerson: FetchPerson = fetchPersonDetail,
): void {
  app.get("/api/people/by-id/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id <= 0) {
      return c.json({ error: "invalid id" }, 400);
    }

    const cached = await database
      .selectFrom("person_metadata")
      .select(["detail", "fetched_at"])
      .where("tmdb_id", "=", id)
      .executeTakeFirst();
    if (cached && cached.fetched_at >= Date.now() - METADATA_TTL_MS) {
      return c.json(JSON.parse(cached.detail) as PersonDetail);
    }

    const person = await fetchPerson(id);
    if (!person) return c.json({ error: "not found" }, 404);

    const row = {
      tmdb_id: person.tmdbId,
      name: person.name,
      detail: JSON.stringify(person),
      fetched_at: Date.now(),
    };
    await database
      .insertInto("person_metadata")
      .values(row)
      .onConflict((oc) =>
        oc.column("tmdb_id").doUpdateSet({
          name: row.name,
          detail: row.detail,
          fetched_at: row.fetched_at,
        }),
      )
      .execute();
    return c.json(person);
  });
}
