import BetterSqlite3 from "better-sqlite3";
import { Hono } from "hono";
import { Kysely, SqliteDialect } from "kysely";
import sharp from "sharp";
import { thumbHashToAverageRGBA } from "thumbhash";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations.js";
import type { Database } from "../db/types.js";
import type { MetadataCollection } from "../metadata/collection.js";
import { registerMetadataRoutes } from "../metadata/routes.js";
import {
  COVER_HASH_RETRY_MS,
  CoverHashQueue,
  resolveCoverHashes,
  startCoverHashWorker,
  thumbHashFromImage,
} from "./coverHashes.js";
import {
  coverFetchUrl,
  goodreadsCoverKey,
  igdbCoverKey,
  igdbCoverKeyFromProxyUrl,
  tmdbCoverKey,
} from "./coverKeys.js";

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

function solidJpeg(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({
    create: { width: 264, height: 374, channels: 3, background: { r, g, b } },
  })
    .jpeg()
    .toBuffer();
}

describe("cover keys", () => {
  it("names covers independently of the displayed size", () => {
    expect(igdbCoverKey("co4hni")).toBe("igdb:co4hni");
    expect(igdbCoverKeyFromProxyUrl("/api/images/t_cover_big/co4hni")).toBe(
      "igdb:co4hni",
    );
    expect(tmdbCoverKey("/abc123.jpg")).toBe("tmdb:/abc123.jpg");
    const base =
      "https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1i/5907";
    expect(goodreadsCoverKey(`${base}._SY75_.jpg`)).toBe(
      goodreadsCoverKey(`${base}.jpg`),
    );
  });

  it("rejects covers it would not know how to fetch safely", () => {
    expect(igdbCoverKey(null)).toBeNull();
    expect(igdbCoverKey("../etc")).toBeNull();
    expect(tmdbCoverKey("https://evil.example/x.jpg")).toBeNull();
    expect(
      goodreadsCoverKey("http://m.media-amazon.com/images/x.jpg"),
    ).toBeNull();
    expect(goodreadsCoverKey("https://evil.example/images/x.jpg")).toBeNull();
    expect(
      goodreadsCoverKey("https://media-amazon.com.evil.example/x.jpg"),
    ).toBeNull();
    expect(coverFetchUrl("goodreads:https://evil.example/x.jpg")).toBeNull();
    expect(coverFetchUrl("nope:x")).toBeNull();
  });

  it("fetches the smallest useful upstream variant", () => {
    expect(coverFetchUrl("igdb:co4hni")).toBe(
      "https://images.igdb.com/igdb/image/upload/t_cover_small/co4hni.jpg",
    );
    expect(coverFetchUrl("tmdb:/abc123.jpg")).toBe(
      "https://image.tmdb.org/t/p/w92/abc123.jpg",
    );
    expect(
      coverFetchUrl(
        "goodreads:https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1i/5907.jpg",
      ),
    ).toBe(
      "https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1i/5907._SY100_.jpg",
    );
  });
});

describe("thumbHashFromImage", () => {
  it("encodes a cover's colours", async () => {
    const hash = await thumbHashFromImage(await solidJpeg(200, 40, 40));
    const { r, g, b } = thumbHashToAverageRGBA(Buffer.from(hash, "base64"));
    expect(r).toBeCloseTo(200 / 255, 1);
    expect(g).toBeCloseTo(40 / 255, 1);
    expect(b).toBeCloseTo(40 / 255, 1);
    expect(hash.length).toBeLessThan(48);
  });
});

describe("CoverHashQueue", () => {
  it("hashes each queued cover once and stores the result", async () => {
    const image = await solidJpeg(20, 120, 220);
    const fetchImage = vi.fn(async () => image);
    const queue = new CoverHashQueue(database, { fetchImage });
    queue.enqueue(["tmdb:/a.jpg", "tmdb:/a.jpg", "igdb:co1"]);
    queue.enqueue(["tmdb:/a.jpg"]);
    await queue.idle();

    expect(fetchImage).toHaveBeenCalledTimes(2);
    const { hashes, missing } = await resolveCoverHashes(database, [
      "tmdb:/a.jpg",
      "igdb:co1",
    ]);
    expect(missing).toEqual([]);
    expect(hashes.get("tmdb:/a.jpg")).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("records failures and retries them after a day", async () => {
    const now = Date.parse("2026-11-13T12:00:00Z");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const queue = new CoverHashQueue(database, {
      fetchImage: async () => {
        throw new Error("404");
      },
      now: () => now,
    });
    queue.enqueue(["tmdb:/gone.jpg"]);
    await queue.idle();
    warn.mockRestore();

    expect(
      (await resolveCoverHashes(database, ["tmdb:/gone.jpg"], now + 1000))
        .missing,
    ).toEqual([]);
    expect(
      (
        await resolveCoverHashes(
          database,
          ["tmdb:/gone.jpg"],
          now + COVER_HASH_RETRY_MS + 1,
        )
      ).missing,
    ).toEqual(["tmdb:/gone.jpg"]);
  });

  it("stops without recording covers interrupted by shutdown", async () => {
    const queue = new CoverHashQueue(database, {
      fetchImage: (_url, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    });
    queue.enqueue(["tmdb:/slow.jpg"]);
    await queue.stop();
    queue.enqueue(["tmdb:/later.jpg"]);
    await queue.idle();

    const rows = await database
      .selectFrom("cover_hashes")
      .selectAll()
      .execute();
    expect(rows).toEqual([]);
  });
});

interface FakeCard {
  id: number;
  cover: string | null;
  coverHash?: string | null;
}

function fakeCollection(): MetadataCollection<
  FakeCard,
  FakeCard,
  number,
  FakeCard
> {
  const cards: FakeCard[] = [
    { id: 1, cover: "/one.jpg" },
    { id: 2, cover: null },
  ];
  return {
    basePath: "/api/fake",
    search: async () => cards,
    cardId: (card) => card.id,
    coverKey: (card) => tmdbCoverKey(card.cover),
    searchCoverKey: (card) => tmdbCoverKey(card.cover),
    fetchCachedCards: async (_db, ids) =>
      new Map(
        cards
          .filter((card) => ids.includes(card.id))
          .map((card) => [card.id, { card, fetchedAt: Date.now() }]),
      ),
    fetchMissingCards: async () => [],
    detail: {
      path: "by-id/:id",
      param: "id",
      parseKey: Number,
      fetchCached: async (_db, id) => {
        const card = cards.find((c) => c.id === id);
        return card ? { detail: card, detailFetchedAt: Date.now() } : null;
      },
      fetchFromSource: async () => null,
      upsert: async () => undefined,
    },
  };
}

describe("metadata routes", () => {
  it("attach known hashes and queue unhashed card covers, but not search ones", async () => {
    const app = new Hono();
    registerMetadataRoutes(app, database, fakeCollection());
    const fetchImage = vi.fn(async () => solidJpeg(10, 10, 10));
    const stop = startCoverHashWorker(database, { fetchImage });
    try {
      const search = await app.request("/api/fake/search?q=x");
      expect(await search.json()).toEqual([
        { id: 1, cover: "/one.jpg", coverHash: null },
        { id: 2, cover: null, coverHash: null },
      ]);
      expect(fetchImage).not.toHaveBeenCalled();

      await app.request("/api/fake?ids=1,2");
      await vi.waitFor(async () => {
        const { missing } = await resolveCoverHashes(database, [
          "tmdb:/one.jpg",
        ]);
        expect(missing).toEqual([]);
      });
      expect(fetchImage).toHaveBeenCalledTimes(1);

      const [hash] = (
        await resolveCoverHashes(database, ["tmdb:/one.jpg"])
      ).hashes.values();
      for (const path of [
        "/api/fake?ids=1",
        "/api/fake/by-id/1",
        "/api/fake/search?q=x",
      ]) {
        const body = (await (await app.request(path)).json()) as
          FakeCard | FakeCard[];
        const first = Array.isArray(body) ? body[0] : body;
        expect(first?.coverHash).toBe(hash);
      }
    } finally {
      await stop();
    }
  });
});
