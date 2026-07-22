import type { Kysely } from "kysely";
import type { Database } from "../db/types.js";

/**
 * The generic metadata-cache route contract. Every medium (games, movies,
 * tv, books) exposes the same three routes — search, cache-first batch
 * lookup by id, and single-item detail fetch with TTL-based refresh — so
 * `registerMetadataRoutes` (./routes.ts) owns that shared HTTP shape while
 * each medium keeps its table-specific SQL, upstream client calls, and
 * DTO<->row mapping in its own descriptor (games/routes.ts, movies/routes.ts,
 * tv/routes.ts, books/routes.ts).
 */

/** A cached card plus the epoch-ms it was last (re)fetched, for TTL comparison. */
export interface CachedCard<TCard> {
  card: TCard;
  fetchedAt: number;
}

/** A cached detail plus its detail-tier fetch time; null means never fetched. */
export interface CachedDetail<TDetail> {
  detail: TDetail;
  detailFetchedAt: number | null;
}

export interface MetadataCollection<TCard, TDetail, TDetailKey = number> {
  /** Route segment mounted under /api, e.g. "/api/games". */
  readonly basePath: string;

  /** Backs `GET :basePath/search?q=...`. */
  search(query: string): Promise<unknown>;

  /** Extracts the numeric id from a card DTO, for keying batch results. */
  cardId(card: TCard): number;

  /**
   * Rows already in the cache for the requested ids, regardless of
   * freshness — the registrar applies the TTL cutoff. Per-medium exclusions
   * (e.g. games' legacy null-slug rows) belong here: an id simply absent
   * from the returned map is treated as a cache miss.
   */
  fetchCachedCards(
    database: Kysely<Database>,
    ids: number[],
  ): Promise<Map<number, CachedCard<TCard>>>;

  /** Fetches every missing id from upstream and upserts it into the cache. */
  fetchMissingCards(
    database: Kysely<Database>,
    missingIds: number[],
  ): Promise<TCard[]>;

  /** Backs the single-item detail route (by numeric id, or by slug for games). */
  readonly detail: DetailRoute<TDetail, TDetailKey>;
}

export interface DetailRoute<TDetail, TDetailKey = number> {
  /** Path appended after basePath, e.g. "by-id/:id" or "by-slug/:slug". */
  readonly path: string;
  /** The Hono param name embedded in `path` (matches its `:name` segment). */
  readonly param: string;
  /** Validates the raw route param; `undefined` yields a 400 (invalid numeric ids). */
  parseKey(raw: string): TDetailKey | undefined;
  /** Cached detail for `key`, or null if the cache has none. */
  fetchCached(
    database: Kysely<Database>,
    key: TDetailKey,
  ): Promise<CachedDetail<TDetail> | null>;
  /** Upstream detail fetch; null signals not-found (-> 404). */
  fetchFromSource(key: TDetailKey): Promise<TDetail | null>;
  /** Persists a freshly fetched detail into the cache. */
  upsert(database: Kysely<Database>, detail: TDetail): Promise<unknown>;
}
