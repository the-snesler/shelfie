import type { Hono } from "hono";
import type { Kysely } from "kysely";
import {
  enqueueCoverHashes,
  resolveCoverHashes,
} from "../covers/coverHashes.js";
import type { Database } from "../db/types.js";
import type { MetadataCollection } from "./collection.js";
import { isCardFresh } from "./freshness.js";

export function parseIds(raw: string): number[] {
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
/**
 * Copies of `items` carrying their cover's cached ThumbHash as `coverHash`
 * (null when none yet). With `queueMissing`, unhashed covers are handed to
 * the background hasher; the response never waits for them.
 */
async function withCoverHashes<T>(
  database: Kysely<Database>,
  items: readonly T[],
  coverKey: (item: T) => string | null,
  queueMissing: boolean,
): Promise<T[]> {
  const keys = items.map(coverKey);
  const { hashes, missing } = await resolveCoverHashes(
    database,
    keys.filter((key): key is string => key !== null),
  );
  if (queueMissing) enqueueCoverHashes(missing);
  return items.map((item, index) => {
    const key = keys[index];
    return { ...item, coverHash: (key && hashes.get(key)) ?? null };
  });
}

export function registerMetadataRoutes<
  TCard,
  TDetail extends TCard,
  TDetailKey = number,
  TSearch = unknown,
>(
  app: Hono,
  database: Kysely<Database>,
  collection: MetadataCollection<TCard, TDetail, TDetailKey, TSearch>,
): void {
  const { basePath, detail } = collection;
  const cardCoverKey = (card: TCard) => collection.coverKey(card);

  const isFresh = (card: TCard, fetchedAt: number, now: number) =>
    isCardFresh(collection, card, fetchedAt, now);

  app.get(`${basePath}/search`, async (c) => {
    const q = c.req.query("q");
    if (!q || q.trim().length === 0) {
      return c.json({ error: "q is required" }, 400);
    }
    const results = await collection.search(q);
    return c.json(
      await withCoverHashes(
        database,
        results,
        (result) => collection.searchCoverKey(result),
        false,
      ),
    );
  });

  app.get(basePath, async (c) => {
    const idsParam = c.req.query("ids");
    const ids = idsParam ? parseIds(idsParam) : [];
    if (ids.length === 0) return c.json<TCard[]>([]);

    const now = Date.now();
    const cachedRows = await collection.fetchCachedCards(database, ids);
    const cachedById = new Map<number, TCard>();
    for (const [id, row] of cachedRows) {
      if (isFresh(row.card, row.fetchedAt, now)) cachedById.set(id, row.card);
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
    return c.json(await withCoverHashes(database, results, cardCoverKey, true));
  });

  app.get(`${basePath}/${detail.path}`, async (c) => {
    const raw = c.req.param(detail.param);
    const key = raw === undefined ? undefined : detail.parseKey(raw);
    if (key === undefined) {
      return c.json({ error: "invalid id" }, 400);
    }

    const cached = await detail.fetchCached(database, key);
    if (
      cached &&
      cached.detailFetchedAt !== null &&
      isFresh(cached.detail, cached.detailFetchedAt, Date.now())
    ) {
      const [withHash] = await withCoverHashes(
        database,
        [cached.detail],
        cardCoverKey,
        true,
      );
      return c.json(withHash);
    }

    const fetched = await detail.fetchFromSource(key);
    if (!fetched) {
      return c.json({ error: "not found" }, 404);
    }
    await detail.upsert(database, fetched);
    const [withHash] = await withCoverHashes(
      database,
      [fetched],
      cardCoverKey,
      true,
    );
    return c.json(withHash);
  });
}
