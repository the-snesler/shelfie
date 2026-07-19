import type { BookDetail, BookMetadata, BookSeries } from "@shelfie/shared";
import type { Hono } from "hono";
import type { Kysely } from "kysely";
import { db as defaultDb } from "../db/index.js";
import type { BookMetadataTable, Database } from "../db/types.js";
import { fetchBookByLegacyId, searchBooks } from "../goodreads/client.js";

const METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function metadataRowToDto(row: BookMetadataTable): BookMetadata {
  return {
    goodreadsId: row.goodreads_id,
    name: row.name,
    coverUrl: row.cover_url,
    authors: JSON.parse(row.authors) as string[],
    year: row.year,
    pageCount: row.page_count,
  };
}

function metadataToRow(metadata: BookMetadata): BookMetadataTable {
  return {
    goodreads_id: metadata.goodreadsId,
    name: metadata.name,
    cover_url: metadata.coverUrl,
    authors: JSON.stringify(metadata.authors),
    year: metadata.year,
    page_count: metadata.pageCount,
    description: null,
    publisher: null,
    publication_date: null,
    isbn13: null,
    series_name: null,
    series_position: null,
    genres: null,
    avg_rating: null,
    ratings_count: null,
    language: null,
    fetched_at: Date.now(),
    detail_fetched_at: null,
  };
}

function metadataRowToDetail(row: BookMetadataTable): BookDetail {
  const series: BookSeries | null = row.series_name
    ? { name: row.series_name, position: row.series_position }
    : null;
  return {
    ...metadataRowToDto(row),
    description: row.description,
    publisher: row.publisher,
    publicationDate: row.publication_date,
    isbn13: row.isbn13,
    series,
    genres: JSON.parse(row.genres ?? "[]") as string[],
    avgRating: row.avg_rating,
    ratingsCount: row.ratings_count,
    language: row.language,
  };
}

function detailToRow(detail: BookDetail): BookMetadataTable {
  return {
    ...metadataToRow(detail),
    description: detail.description,
    publisher: detail.publisher,
    publication_date: detail.publicationDate,
    isbn13: detail.isbn13,
    series_name: detail.series?.name ?? null,
    series_position: detail.series?.position ?? null,
    genres: JSON.stringify(detail.genres),
    avg_rating: detail.avgRating,
    ratings_count: detail.ratingsCount,
    language: detail.language,
    detail_fetched_at: Date.now(),
  };
}

/** Upserts a fetched book's detail row into the cache, keyed by goodreads_id (backfills card columns too). */
async function upsertDetail(
  database: Kysely<Database>,
  detail: BookDetail,
): Promise<BookMetadataTable> {
  const row = detailToRow(detail);
  await database
    .insertInto("book_metadata")
    .values(row)
    .onConflict((oc) =>
      oc.column("goodreads_id").doUpdateSet({
        name: row.name,
        cover_url: row.cover_url,
        authors: row.authors,
        year: row.year,
        page_count: row.page_count,
        fetched_at: row.fetched_at,
        description: row.description,
        publisher: row.publisher,
        publication_date: row.publication_date,
        isbn13: row.isbn13,
        series_name: row.series_name,
        series_position: row.series_position,
        genres: row.genres,
        avg_rating: row.avg_rating,
        ratings_count: row.ratings_count,
        language: row.language,
        detail_fetched_at: row.detail_fetched_at,
      }),
    )
    .execute();
  return row;
}

function parseIds(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
    .filter((id) => Number.isInteger(id));
}

export function registerBooksRoutes(
  app: Hono,
  database: Kysely<Database> = defaultDb,
): void {
  app.get("/api/books/search", async (c) => {
    const q = c.req.query("q");
    if (!q || q.trim().length === 0) {
      return c.json({ error: "q is required" }, 400);
    }
    const results = await searchBooks(q);
    return c.json(results);
  });

  app.get("/api/books", async (c) => {
    const idsParam = c.req.query("ids");
    const ids = idsParam ? parseIds(idsParam) : [];
    if (ids.length === 0) return c.json<BookMetadata[]>([]);

    const cached = await database
      .selectFrom("book_metadata")
      .selectAll()
      .where("goodreads_id", "in", ids)
      .execute();
    const cachedById = new Map(cached.map((row) => [row.goodreads_id, row]));

    const missingIds = ids.filter((id) => {
      const row = cachedById.get(id);
      return !row || row.fetched_at < Date.now() - METADATA_TTL_MS;
    });
    // Goodreads has no batch-by-id endpoint; fan each miss through the
    // shared throttle sequentially via the detail (card-superset) query.
    for (const id of missingIds) {
      const detail = await fetchBookByLegacyId(id);
      if (!detail) continue;
      const row = await upsertDetail(database, detail);
      cachedById.set(id, row);
    }

    const results: BookMetadata[] = [];
    for (const id of ids) {
      const row = cachedById.get(id);
      if (row) results.push(metadataRowToDto(row));
    }
    return c.json(results);
  });

  app.get("/api/books/by-id/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) {
      return c.json({ error: "invalid id" }, 400);
    }

    const cached = await database
      .selectFrom("book_metadata")
      .selectAll()
      .where("goodreads_id", "=", id)
      .executeTakeFirst();
    if (
      cached &&
      cached.detail_fetched_at !== null &&
      cached.detail_fetched_at >= Date.now() - METADATA_TTL_MS
    ) {
      return c.json(metadataRowToDetail(cached));
    }

    const detail = await fetchBookByLegacyId(id);
    if (!detail) {
      return c.json({ error: "not found" }, 404);
    }
    await upsertDetail(database, detail);
    return c.json(detail);
  });
}
