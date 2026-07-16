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

interface IgdbReleaseDate {
  date?: number;
  platform?: { name: string };
}

interface IgdbInvolvedCompany {
  company: { name: string };
  developer: boolean;
}

interface IgdbSearchGame {
  id: number;
  name: string;
  slug?: string;
  cover?: IgdbCover;
  first_release_date?: number;
  platforms?: IgdbPlatform[];
}

interface IgdbMetadataGame {
  id: number;
  name: string;
  slug?: string;
  summary?: string;
  cover?: IgdbCover;
  genres?: IgdbGenre[];
  platforms?: IgdbPlatform[];
  release_dates?: IgdbReleaseDate[];
  first_release_date?: number;
  involved_companies?: IgdbInvolvedCompany[];
}

/** Fields shared by fetchGamesByIds and fetchGameBySlug metadata queries. */
const METADATA_FIELDS =
  "name,slug,summary,cover.image_id,genres.name,platforms.name,first_release_date,involved_companies.company.name,involved_companies.developer,release_dates.date,release_dates.platform.name";

/** Maps a raw IGDB metadata game into the DTO; null when IGDB omitted the slug. */
function metadataGameToDto(game: IgdbMetadataGame): GameMetadata | null {
  if (!game.slug) return null;
  const releaseByPlatform = new Map<string, number>();
  for (const rd of game.release_dates ?? []) {
    const name = rd.platform?.name;
    if (!name || rd.date === undefined) continue;
    const prev = releaseByPlatform.get(name);
    if (prev === undefined || rd.date < prev) releaseByPlatform.set(name, rd.date);
  }
  const platformReleaseDates = [...releaseByPlatform.entries()]
    .map(([platform, date]) => ({ platform, date }))
    .sort((a, b) => a.date - b.date);
  return {
    igdbId: game.id,
    slug: game.slug,
    name: game.name,
    coverImageId: game.cover?.image_id ?? null,
    summary: game.summary ?? null,
    genres: (game.genres ?? []).map((genre) => genre.name),
    platforms: (game.platforms ?? []).map((platform) => platform.name),
    platformReleaseDates,
    developer: extractDeveloper(game.involved_companies),
    firstReleaseDate: game.first_release_date ?? null,
  };
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

function extractDeveloper(
  companies: IgdbInvolvedCompany[] | undefined,
): string | null {
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
  const query = `search "${escapeApicalypseString(q)}"; fields name,slug,cover.image_id,first_release_date,platforms.name; where game_type = 0; limit 20;`;
  const res = await igdbFetch(query);
  if (!res.ok) {
    throw new Error(`IGDB search failed: ${res.status}`);
  }
  const games = (await res.json()) as IgdbSearchGame[];
  const results: SearchResult[] = [];
  for (const game of games) {
    if (!game.slug) continue;
    results.push({
      igdbId: game.id,
      slug: game.slug,
      name: game.name,
      coverUrl: coverUrl(game.cover?.image_id),
      year: epochSecondsToYear(game.first_release_date),
      platforms: (game.platforms ?? []).map((platform) => platform.name),
    });
  }
  return results;
}

export async function fetchGamesByIds(ids: number[]): Promise<GameMetadata[]> {
  if (ids.length === 0) return [];
  const query = `fields ${METADATA_FIELDS}; where id = (${ids.join(",")}); limit ${ids.length};`;
  const res = await igdbFetch(query);
  if (!res.ok) {
    throw new Error(`IGDB metadata fetch failed: ${res.status}`);
  }
  const games = (await res.json()) as IgdbMetadataGame[];
  const results: GameMetadata[] = [];
  for (const game of games) {
    const dto = metadataGameToDto(game);
    if (dto) results.push(dto);
  }
  return results;
}

/** Looks up a single game by its IGDB URL slug; null if IGDB has no such slug. */
export async function fetchGameBySlug(
  slug: string,
): Promise<GameMetadata | null> {
  const query = `fields ${METADATA_FIELDS}; where slug = "${escapeApicalypseString(slug)}"; limit 1;`;
  const res = await igdbFetch(query);
  if (!res.ok) {
    throw new Error(`IGDB metadata fetch failed: ${res.status}`);
  }
  const games = (await res.json()) as IgdbMetadataGame[];
  const [game] = games;
  return game ? metadataGameToDto(game) : null;
}
