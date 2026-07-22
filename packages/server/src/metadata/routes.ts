import type { Hono } from "hono";
import type { Kysely } from "kysely";
import type { Database } from "../db/types.js";
import type { MetadataCollection } from "./collection.js";

const METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function parseIds(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
    .filter((id) => Number.isInteger(id));
}

/**
 * Mounts a medium's search / batch-by-ids / detail-by-key routes against the
 * shared cache-first orchestration: id parsing, TTL freshness checks,
 * ordered batch assembly, invalid-numeric-id 400s, and not-found 404s all
 * live here so every medium (games, movies, tv, books) gets identical HTTP
 * behaviour from a table-specific descriptor.
 */
export function registerMetadataRoutes<TCard, TDetail, TDetailKey = number>(
  app: Hono,
  database: Kysely<Database>,
  collection: MetadataCollection<TCard, TDetail, TDetailKey>,
): void {
  const { basePath, detail } = collection;

  app.get(`${basePath}/search`, async (c) => {
    const q = c.req.query("q");
    if (!q || q.trim().length === 0) {
      return c.json({ error: "q is required" }, 400);
    }
    const results = await collection.search(q);
    return c.json(results);
  });

  app.get(basePath, async (c) => {
    const idsParam = c.req.query("ids");
    const ids = idsParam ? parseIds(idsParam) : [];
    if (ids.length === 0) return c.json<TCard[]>([]);

    const cutoff = Date.now() - METADATA_TTL_MS;
    const cachedRows = await collection.fetchCachedCards(database, ids);
    const cachedById = new Map<number, TCard>();
    for (const [id, row] of cachedRows) {
      if (row.fetchedAt >= cutoff) cachedById.set(id, row.card);
    }

    const missingIds = ids.filter((id) => !cachedById.has(id));
    if (missingIds.length > 0) {
      const fetched = await collection.fetchMissingCards(database, missingIds);
      for (const card of fetched) {
        cachedById.set(collection.cardId(card), card);
      }
    }

    const results: TCard[] = [];
    for (const id of ids) {
      const card = cachedById.get(id);
      if (card) results.push(card);
    }
    return c.json(results);
  });

  app.get(`${basePath}/${detail.path}`, async (c) => {
    const raw = c.req.param(detail.param);
    const key = raw === undefined ? undefined : detail.parseKey(raw);
    if (key === undefined) {
      return c.json({ error: "invalid id" }, 400);
    }

    const cutoff = Date.now() - METADATA_TTL_MS;
    const cached = await detail.fetchCached(database, key);
    if (
      cached &&
      cached.detailFetchedAt !== null &&
      cached.detailFetchedAt >= cutoff
    ) {
      return c.json(cached.detail);
    }

    const fetched = await detail.fetchFromSource(key);
    if (!fetched) {
      return c.json({ error: "not found" }, 404);
    }
    await detail.upsert(database, fetched);
    return c.json(fetched);
  });
}
