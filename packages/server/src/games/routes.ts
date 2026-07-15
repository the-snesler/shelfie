import type { GameMetadata } from "@shelfie/shared";
import type { Hono } from "hono";
import type { Kysely } from "kysely";
import { db as defaultDb } from "../db/index.js";
import type { Database, GameMetadataTable } from "../db/types.js";
import { fetchGamesByIds, searchGames } from "../igdb/client.js";

function metadataRowToDto(row: GameMetadataTable): GameMetadata {
  return {
    igdbId: row.igdb_id,
    name: row.name,
    coverImageId: row.cover_image_id,
    summary: row.summary,
    genres: JSON.parse(row.genres) as string[],
    platforms: JSON.parse(row.platforms) as string[],
    developer: row.developer,
    firstReleaseDate: row.first_release_date,
  };
}

function metadataToRow(metadata: GameMetadata): GameMetadataTable {
  return {
    igdb_id: metadata.igdbId,
    name: metadata.name,
    cover_image_id: metadata.coverImageId,
    summary: metadata.summary,
    genres: JSON.stringify(metadata.genres),
    platforms: JSON.stringify(metadata.platforms),
    developer: metadata.developer,
    first_release_date: metadata.firstReleaseDate,
    fetched_at: Date.now(),
  };
}

function parseIds(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
    .filter((id) => Number.isInteger(id));
}

export function registerGamesRoutes(
  app: Hono,
  database: Kysely<Database> = defaultDb,
): void {
  app.get("/api/games/search", async (c) => {
    const q = c.req.query("q");
    if (!q || q.trim().length === 0) {
      return c.json({ error: "q is required" }, 400);
    }
    const results = await searchGames(q);
    return c.json(results);
  });

  app.get("/api/games", async (c) => {
    const idsParam = c.req.query("ids");
    const ids = idsParam ? parseIds(idsParam) : [];
    if (ids.length === 0) return c.json<GameMetadata[]>([]);

    const cached = await database
      .selectFrom("game_metadata")
      .selectAll()
      .where("igdb_id", "in", ids)
      .execute();
    const cachedById = new Map(cached.map((row) => [row.igdb_id, row]));

    const missingIds = ids.filter((id) => !cachedById.has(id));
    if (missingIds.length > 0) {
      const fetched = await fetchGamesByIds(missingIds);
      for (const metadata of fetched) {
        const row = metadataToRow(metadata);
        await database
          .insertInto("game_metadata")
          .values(row)
          .onConflict((oc) =>
            oc.column("igdb_id").doUpdateSet({
              name: row.name,
              cover_image_id: row.cover_image_id,
              summary: row.summary,
              genres: row.genres,
              platforms: row.platforms,
              developer: row.developer,
              first_release_date: row.first_release_date,
              fetched_at: row.fetched_at,
            }),
          )
          .execute();
        cachedById.set(metadata.igdbId, row);
      }
    }

    const results: GameMetadata[] = [];
    for (const id of ids) {
      const row = cachedById.get(id);
      if (row) results.push(metadataRowToDto(row));
    }
    return c.json(results);
  });
}
