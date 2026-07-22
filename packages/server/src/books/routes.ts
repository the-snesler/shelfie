import type { BookDetail, BookMetadata, BookSeries } from "@shelfie/shared";
import type { Hono } from "hono";
import type { Kysely } from "kysely";
import { db as defaultDb } from "../db/index.js";
import type { BookMetadataTable, Database } from "../db/types.js";
import { fetchBookByLegacyId, searchBooks } from "../goodreads/client.js";
import type { CachedCard, MetadataCollection } from "../metadata/collection.js";
import { registerMetadataRoutes } from "../metadata/routes.js";

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

const booksMetadataCollection: MetadataCollection<BookMetadata, BookDetail> = {
  basePath: "/api/books",

  search: searchBooks,

  cardId: (card) => card.goodreadsId,

  async fetchCachedCards(database, ids) {
    const cached = await database
      .selectFrom("book_metadata")
      .selectAll()
      .where("goodreads_id", "in", ids)
      .execute();

    const result = new Map<number, CachedCard<BookMetadata>>();
    for (const row of cached) {
      result.set(row.goodreads_id, {
        card: metadataRowToDto(row),
        fetchedAt: row.fetched_at,
      });
    }
    return result;
  },

  async fetchMissingCards(database, missingIds) {
    // Goodreads has no batch-by-id endpoint; the client's shared throttle
    // already serializes outbound calls, so fan every miss out concurrently
    // and let the throttle queue them.
    const fetched = await Promise.all(
      missingIds.map((id) => fetchBookByLegacyId(id)),
    );
    const cards: BookMetadata[] = [];
    for (const detail of fetched) {
      if (!detail) continue;
      const row = await upsertDetail(database, detail);
      cards.push(metadataRowToDto(row));
    }
    return cards;
  },

  detail: {
    path: "by-id/:id",
    param: "id",

    parseKey(raw) {
      const id = Number(raw);
      return Number.isInteger(id) ? id : undefined;
    },

    async fetchCached(database, id) {
      const cached = await database
        .selectFrom("book_metadata")
        .selectAll()
        .where("goodreads_id", "=", id)
        .executeTakeFirst();
      if (!cached) return null;
      return {
        detail: metadataRowToDetail(cached),
        detailFetchedAt: cached.detail_fetched_at,
      };
    },

    fetchFromSource: (id) => fetchBookByLegacyId(id),

    upsert: (database, detail) => upsertDetail(database, detail),
  },
};

export function registerBooksRoutes(
  app: Hono,
  database: Kysely<Database> = defaultDb,
): void {
  registerMetadataRoutes(app, database, booksMetadataCollection);
}
