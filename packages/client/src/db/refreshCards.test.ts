import type {
  BookMetadata,
  GameMetadata,
  LibraryItem,
  MediaType,
  MovieMetadata,
  TvMetadata,
} from "@shelfie/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authFetch, getAuthToken } from "../auth";
import { upsertOwnedCards } from "./cardCache";
import type { ShelfieDatabase } from "./database";
import { refreshCardCaches } from "./refreshCards";

vi.mock("../auth", () => ({ authFetch: vi.fn(), getAuthToken: vi.fn() }));
vi.mock("./cardCache", () => ({ upsertOwnedCards: vi.fn() }));

const db = {} as ShelfieDatabase;
const media = {
  games: "game",
  movies: "movie",
  tv: "tv",
  books: "book",
} as const;
type OwnedId = Pick<LibraryItem, "mediaType" | "sourceId">;

function request(input: RequestInfo | URL) {
  const url = new URL(String(input), "https://shelfie.example");
  const medium = url.pathname.split("/").at(-1) as keyof typeof media;
  return { type: media[medium], ids: url.searchParams.get("ids")!.split(",") };
}

function card(
  type: MediaType,
  id: string,
): GameMetadata | MovieMetadata | TvMetadata | BookMetadata {
  const common = { name: `Refreshed ${type}:${id}`, genres: [], summary: null };
  if (type === "game")
    return {
      ...common,
      igdbId: Number(id),
      slug: `game-${id}`,
      coverImageId: null,
      platforms: [],
      platformReleaseDates: [],
      developer: null,
      firstReleaseDate: null,
      timeToBeat: null,
    };
  if (type === "movie")
    return {
      ...common,
      tmdbId: Number(id),
      posterPath: null,
      releaseDate: null,
      director: null,
      runtime: null,
    };
  if (type === "tv")
    return {
      ...common,
      tmdbId: Number(id),
      posterPath: null,
      firstAirYear: null,
      firstAirDate: null,
      status: null,
      numberOfSeasons: 0,
      numberOfEpisodes: 0,
      networks: [],
      createdBy: [],
      nextEpisodeToAir: null,
      lastEpisodeToAir: null,
      airedEpisodes: null,
    };
  return {
    goodreadsId: Number(id),
    name: common.name,
    coverUrl: null,
    authors: [],
    publicationDate: null,
    pageCount: null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(upsertOwnedCards).mockResolvedValue(undefined);
  vi.mocked(getAuthToken).mockReturnValue("owner-token");
});

describe("warming cards after large source imports", () => {
  it("refreshes more than 500 owned ids per medium through bounded requests and concurrency", async () => {
    const items: OwnedId[] = Object.values(media).flatMap((mediaType) =>
      Array.from({ length: 501 }, (_, index) => ({
        mediaType,
        sourceId: String(index + 1),
      })),
    );
    items.push(items[0]);
    const batches: { type: MediaType; ids: string[] }[] = [];
    const activeByType = new Map<MediaType, number>();
    let active = 0;
    let peak = 0;
    vi.mocked(authFetch).mockImplementation(async (input) => {
      const batch = request(input);
      expect(batch.ids.length).toBeLessThanOrEqual(100);
      expect(activeByType.get(batch.type) ?? 0).toBe(0);
      batches.push(batch);
      activeByType.set(batch.type, 1);
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      activeByType.set(batch.type, 0);
      return Response.json(batch.ids.map((id) => card(batch.type, id)));
    });
    await refreshCardCaches(db, items);
    const expected = new Set(
      items.map((item) => `${item.mediaType}:${item.sourceId}`),
    );
    const fetched = batches.flatMap((batch) =>
      batch.ids.map((id) => `${batch.type}:${id}`),
    );
    const stored = vi
      .mocked(upsertOwnedCards)
      .mock.calls.flatMap(([, cards]) => cards.map((card) => card.id));
    expect(new Set(fetched)).toEqual(expected);
    expect(fetched).toHaveLength(expected.size);
    expect(new Set(stored)).toEqual(expected);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it.each(["network", "http"])(
    "retains cached cards for a failed %s batch while refreshing later batches and other media",
    async (failure) => {
      const items: OwnedId[] = Array.from({ length: 250 }, (_, index) => ({
        mediaType: "game",
        sourceId: String(index + 1),
      }));
      items.push({ mediaType: "movie", sourceId: "1" });
      const cached = new Map(
        items.map((item) => [
          `${item.mediaType}:${item.sourceId}`,
          "Previously cached",
        ]),
      );
      let gameBatch = 0;
      let failed: string[] = [];
      vi.mocked(authFetch).mockImplementation(async (input) => {
        const batch = request(input);
        if (batch.type === "game" && ++gameBatch === 2) {
          failed = batch.ids.map((id) => `game:${id}`);
          if (failure === "network") throw new Error("offline");
          return new Response(null, { status: 502 });
        }
        return Response.json(batch.ids.map((id) => card(batch.type, id)));
      });
      vi.mocked(upsertOwnedCards).mockImplementation(async (_, cards) => {
        for (const card of cards) cached.set(card.id, card.name);
      });
      await refreshCardCaches(db, items);
      expect(failed.length).toBeGreaterThan(0);
      expect(gameBatch).toBeGreaterThan(2);
      for (const [id, name] of cached) {
        expect(name).toBe(
          failed.includes(id) ? "Previously cached" : `Refreshed ${id}`,
        );
      }
    },
  );
});

describe("guest refreshes", () => {
  const DAY = 24 * 60 * 60 * 1000;

  /** A guest database whose card caches hold `cached` ids, written at the
   *  given time (RxDB's last-write time). */
  function guestDb(cached: Record<string, number>): ShelfieDatabase {
    const collection = {
      findByIds: (ids: string[]) => ({
        exec: async () =>
          new Map(
            ids
              .filter((id) => id in cached)
              .map((id) => [id, { _data: { _meta: { lwt: cached[id] } } }]),
          ),
      }),
    };
    return {
      game_metadata: collection,
      movie_metadata: collection,
      tv_metadata: collection,
      book_metadata: collection,
    } as unknown as ShelfieDatabase;
  }

  function serveCards() {
    const batches: { type: MediaType; ids: string[] }[] = [];
    vi.mocked(authFetch).mockImplementation(async (input) => {
      const batch = request(input);
      batches.push(batch);
      return Response.json(batch.ids.map((id) => card(batch.type, id)));
    });
    return batches;
  }

  it("fetches only missing or week-old cards, missing first, within the anonymous quota", async () => {
    vi.mocked(getAuthToken).mockReturnValue(null);
    const now = Date.now();
    const cached: Record<string, number> = {};
    const items: OwnedId[] = [];
    // 20 fresh cards, 5 stale games, 8 missing movies.
    for (let i = 1; i <= 20; i++) {
      cached[`book:${i}`] = now - DAY;
      items.push({ mediaType: "book", sourceId: String(i) });
    }
    for (let i = 1; i <= 5; i++) {
      cached[`game:${i}`] = now - 8 * DAY;
      items.push({ mediaType: "game", sourceId: String(i) });
    }
    for (let i = 1; i <= 8; i++)
      items.push({ mediaType: "movie", sourceId: String(i) });
    const batches = serveCards();

    await refreshCardCaches(guestDb(cached), items);

    const fetched = batches.flatMap((batch) =>
      batch.ids.map((id) => `${batch.type}:${id}`),
    );
    expect(fetched).toHaveLength(10);
    expect(fetched.filter((id) => id.startsWith("movie:"))).toHaveLength(8);
    expect(fetched.filter((id) => id.startsWith("game:"))).toHaveLength(2);
    expect(fetched.some((id) => id.startsWith("book:"))).toBe(false);
    for (const batch of batches)
      expect(batch.ids.length).toBeLessThanOrEqual(10);

    // The same ids are not requested again on the next mount.
    batches.length = 0;
    await refreshCardCaches(guestDb(cached), items);
    const retried = batches.flatMap((batch) =>
      batch.ids.map((id) => `${batch.type}:${id}`),
    );
    expect(retried).toEqual(["game:3", "game:4", "game:5"]);
  });

  it("refreshes everything for the owner regardless of cache age", async () => {
    const batches = serveCards();
    await refreshCardCaches(guestDb({ "game:1": Date.now() }), [
      { mediaType: "game", sourceId: "1" },
    ]);
    expect(batches).toEqual([{ type: "game", ids: ["1"] }]);
  });
});
