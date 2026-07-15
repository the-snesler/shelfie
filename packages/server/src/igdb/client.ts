import type { GameMetadata, SearchResult } from "@shelfie/shared";
import { getIgdbToken, invalidateIgdbToken } from "./token.js";

const IGDB_GAMES_URL = "https://api.igdb.com/v4/games";

/** IGDB allows at most 4 requests/second per Client-ID; self-throttle to stay under it. */
const MIN_REQUEST_INTERVAL_MS = 260;
let requestQueue: Promise<void> = Promise.resolve();

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function throttle(): Promise<void> {
  const next = requestQueue.then(() => delay(MIN_REQUEST_INTERVAL_MS));
  requestQueue = next;
  return next;
}

interface IgdbCover {
  image_id: string;
}

interface IgdbPlatform {
  name: string;
}

interface IgdbGenre {
  name: string;
}

interface IgdbInvolvedCompany {
  company: { name: string };
  developer: boolean;
}

interface IgdbSearchGame {
  id: number;
  name: string;
  cover?: IgdbCover;
  first_release_date?: number;
  platforms?: IgdbPlatform[];
}

interface IgdbMetadataGame {
  id: number;
  name: string;
  summary?: string;
  cover?: IgdbCover;
  genres?: IgdbGenre[];
  platforms?: IgdbPlatform[];
  first_release_date?: number;
  involved_companies?: IgdbInvolvedCompany[];
}

/** Requests IGDB with a 401-retry-once (revoked/rotated credentials safety net). */
async function igdbFetch(body: string, retried = false): Promise<Response> {
  await throttle();
  const token = await getIgdbToken();
  const res = await fetch(IGDB_GAMES_URL, {
    method: "POST",
    headers: {
      "Client-ID": process.env.IGDB_CLIENT_ID ?? "",
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body,
  });
  if (res.status === 401 && !retried) {
    invalidateIgdbToken();
    return igdbFetch(body, true);
  }
  if (res.status === 429) {
    throw new Error("IGDB rate limit exceeded");
  }
  return res;
}

function coverUrl(imageId: string | undefined): string | null {
  return imageId
    ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`
    : null;
}

function extractDeveloper(companies: IgdbInvolvedCompany[] | undefined): string | null {
  const dev = companies?.find((company) => company.developer);
  return dev?.company.name ?? null;
}

function epochSecondsToYear(epochSeconds: number | undefined): number | null {
  return epochSeconds ? new Date(epochSeconds * 1000).getUTCFullYear() : null;
}

/** Apicalypse string literal escaping: backslash then double-quote. */
function escapeApicalypseString(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function searchGames(q: string): Promise<SearchResult[]> {
  const query = `search "${escapeApicalypseString(q)}"; fields name,cover.image_id,first_release_date,platforms.name; where game_type = 0; limit 20;`;
  const res = await igdbFetch(query);
  if (!res.ok) {
    throw new Error(`IGDB search failed: ${res.status}`);
  }
  const games = (await res.json()) as IgdbSearchGame[];
  return games.map((game) => ({
    igdbId: game.id,
    name: game.name,
    coverUrl: coverUrl(game.cover?.image_id),
    year: epochSecondsToYear(game.first_release_date),
    platforms: (game.platforms ?? []).map((platform) => platform.name),
  }));
}

export async function fetchGamesByIds(ids: number[]): Promise<GameMetadata[]> {
  if (ids.length === 0) return [];
  const query = `fields name,summary,cover.image_id,genres.name,platforms.name,first_release_date,involved_companies.company.name,involved_companies.developer; where id = (${ids.join(",")}); limit ${ids.length};`;
  const res = await igdbFetch(query);
  if (!res.ok) {
    throw new Error(`IGDB metadata fetch failed: ${res.status}`);
  }
  const games = (await res.json()) as IgdbMetadataGame[];
  return games.map((game) => ({
    igdbId: game.id,
    name: game.name,
    coverImageId: game.cover?.image_id ?? null,
    summary: game.summary ?? null,
    genres: (game.genres ?? []).map((genre) => genre.name),
    platforms: (game.platforms ?? []).map((platform) => platform.name),
    developer: extractDeveloper(game.involved_companies),
    firstReleaseDate: game.first_release_date ?? null,
  }));
}
