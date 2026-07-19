import type {
  GameMetadata,
  GameDetail,
  GameVideo,
  SearchResult,
  StoreLink,
  StoreName,
  TimeToBeat,
} from "@shelfie/shared";
import { getIgdbToken, invalidateIgdbToken } from "./token.js";
import { rankSearchGames } from "./rank.js";

const IGDB_GAMES_URL = "https://api.igdb.com/v4/games";
const IGDB_TIME_TO_BEATS_URL = "https://api.igdb.com/v4/game_time_to_beats";

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
  publisher?: boolean;
}

interface IgdbSearchGame {
  id: number;
  name: string;
  slug?: string;
  cover?: IgdbCover;
  first_release_date?: number;
  platforms?: IgdbPlatform[];
  total_rating_count?: number;
  hypes?: number;
}

interface IgdbNamed {
  name: string;
}

interface IgdbScreenshot {
  image_id?: string;
}

interface IgdbVideo {
  video_id?: string;
  name?: string;
}

interface IgdbWebsite {
  type?: number;
  url?: string;
  trusted?: boolean;
}

interface IgdbTimeToBeat {
  game_id?: number;
  hastily?: number;
  normally?: number;
  completely?: number;
  count?: number;
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
  storyline?: string;
  screenshots?: IgdbScreenshot[];
  videos?: IgdbVideo[];
  game_modes?: IgdbNamed[];
  themes?: IgdbNamed[];
  player_perspectives?: IgdbNamed[];
  aggregated_rating?: number;
  aggregated_rating_count?: number;
  rating?: number;
  rating_count?: number;
  websites?: IgdbWebsite[];
}

/** Fields shared by fetchGamesByIds and fetchGameBySlug metadata queries. */
const CARD_FIELDS =
  "name,slug,summary,cover.image_id,genres.name,platforms.name,first_release_date,involved_companies.company.name,involved_companies.developer,release_dates.date,release_dates.platform.name";

const DETAIL_FIELDS =
  CARD_FIELDS +
  ",storyline,screenshots.image_id,videos.video_id,videos.name,game_modes.name,themes.name,player_perspectives.name,involved_companies.publisher,aggregated_rating,aggregated_rating_count,rating,rating_count,websites.type,websites.url,websites.trusted";

/** Maps a raw IGDB metadata game into the DTO; null when IGDB omitted the slug. */
function metadataGameToDto(game: IgdbMetadataGame): GameMetadata | null {
  if (!game.slug) return null;
  const releaseByPlatform = new Map<string, number>();
  for (const rd of game.release_dates ?? []) {
    const name = rd.platform?.name;
    if (!name || rd.date === undefined) continue;
    const prev = releaseByPlatform.get(name);
    if (prev === undefined || rd.date < prev)
      releaseByPlatform.set(name, rd.date);
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
    timeToBeat: null,
  };
}

const STORE_CATEGORIES: Record<number, StoreName> = {
  1: "official",
  13: "steam",
  16: "epic",
  17: "gog",
  15: "itch",
};

function websitesToStores(websites: IgdbWebsite[] | undefined): StoreLink[] {
  const stores: StoreLink[] = [];
  for (const site of websites ?? []) {
    const store =
      site.type !== undefined ? STORE_CATEGORIES[site.type] : undefined;
    if (!store || !site.url) continue;
    stores.push({ store, url: site.url });
  }
  return stores;
}

/** Maps a raw IGDB metadata game into the detail DTO; null when IGDB omitted the slug. */
function detailGameToDto(game: IgdbMetadataGame): GameDetail | null {
  const card = metadataGameToDto(game);
  if (!card) return null;
  return {
    ...card,
    storyline: game.storyline ?? null,
    screenshotImageIds: (game.screenshots ?? [])
      .map((s) => s.image_id)
      .filter((id): id is string => Boolean(id)),
    videos: (game.videos ?? [])
      .filter((v): v is IgdbVideo & { video_id: string } => Boolean(v.video_id))
      .map((v): GameVideo => ({ videoId: v.video_id, name: v.name ?? null })),
    gameModes: (game.game_modes ?? []).map((m) => m.name),
    themes: (game.themes ?? []).map((t) => t.name),
    playerPerspectives: (game.player_perspectives ?? []).map((p) => p.name),
    publisher: extractPublisher(game.involved_companies),
    aggregatedRating: game.aggregated_rating ?? null,
    aggregatedRatingCount: game.aggregated_rating_count ?? 0,
    rating: game.rating ?? null,
    ratingCount: game.rating_count ?? 0,
    stores: websitesToStores(game.websites),
    timeToBeat: null,
  };
}

/** Requests IGDB with a 401-retry-once (revoked/rotated credentials safety net). */
async function igdbFetch(
  url: string,
  body: string,
  retried = false,
): Promise<Response> {
  await throttle();
  const token = await getIgdbToken();
  const res = await fetch(url, {
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
    return igdbFetch(url, body, true);
  }
  if (res.status === 429) {
    throw new Error("IGDB rate limit exceeded");
  }
  return res;
}

function coverUrl(imageId: string | undefined): string | null {
  return imageId ? `/api/images/t_cover_big/${imageId}` : null;
}

function extractDeveloper(
  companies: IgdbInvolvedCompany[] | undefined,
): string | null {
  const dev = companies?.find((company) => company.developer);
  return dev?.company.name ?? null;
}

function extractPublisher(
  companies: IgdbInvolvedCompany[] | undefined,
): string | null {
  const pub = companies?.find((company) => company.publisher);
  return pub?.company.name ?? null;
}

function epochSecondsToYear(epochSeconds: number | undefined): number | null {
  return epochSeconds ? new Date(epochSeconds * 1000).getUTCFullYear() : null;
}

/** Apicalypse string literal escaping: backslash then double-quote. */
function escapeApicalypseString(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function searchGames(q: string): Promise<SearchResult[]> {
  const query = `search "${escapeApicalypseString(q)}"; fields name,slug,cover.image_id,first_release_date,platforms.name,total_rating_count,hypes; where game_type = 0; limit 50;`;
  const res = await igdbFetch(IGDB_GAMES_URL, query);
  if (!res.ok) {
    throw new Error(`IGDB search failed: ${res.status}`);
  }
  const games = (await res.json()) as IgdbSearchGame[];
  const ranked = rankSearchGames(q, games).slice(0, 20);
  const results: SearchResult[] = [];
  for (const game of ranked) {
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
  const query = `fields ${CARD_FIELDS}; where id = (${ids.join(",")}); limit ${ids.length};`;
  const res = await igdbFetch(IGDB_GAMES_URL, query);
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

function timeToBeatFromRow(row: IgdbTimeToBeat): TimeToBeat {
  return {
    hastily: row.hastily ? row.hastily : null,
    normally: row.normally ? row.normally : null,
    completely: row.completely ? row.completely : null,
    count: row.count ?? 0,
  };
}

/** Best-effort lookup; a failing/empty response or errored request yields null rather than failing the detail fetch. */
async function fetchTimeToBeat(igdbId: number): Promise<TimeToBeat | null> {
  try {
    const query = `fields hastily,normally,completely,count; where game_id = ${igdbId}; limit 1;`;
    const res = await igdbFetch(IGDB_TIME_TO_BEATS_URL, query);
    if (!res.ok) return null;
    const rows = (await res.json()) as IgdbTimeToBeat[];
    const [row] = rows;
    if (!row) return null;
    return timeToBeatFromRow(row);
  } catch {
    return null;
  }
}

/** Best-effort batch TTB by game id. Errors/misses yield an empty (or partial)
 *  map rather than failing the caller. */
export async function fetchTimeToBeatsByIds(
  ids: number[],
): Promise<Map<number, TimeToBeat>> {
  const out = new Map<number, TimeToBeat>();
  if (ids.length === 0) return out;
  try {
    const query = `fields game_id,hastily,normally,completely,count; where game_id = (${ids.join(",")}); limit ${ids.length};`;
    const res = await igdbFetch(IGDB_TIME_TO_BEATS_URL, query);
    if (!res.ok) return out;
    const rows = (await res.json()) as IgdbTimeToBeat[];
    for (const row of rows) {
      if (row.game_id !== undefined)
        out.set(row.game_id, timeToBeatFromRow(row));
    }
  } catch {
    // best-effort: swallow, return whatever was collected
  }
  return out;
}

/** Looks up a single game by its IGDB URL slug; null if IGDB has no such slug. */
export async function fetchGameDetailBySlug(
  slug: string,
): Promise<GameDetail | null> {
  const query = `fields ${DETAIL_FIELDS}; where slug = "${escapeApicalypseString(slug)}"; limit 1;`;
  const res = await igdbFetch(IGDB_GAMES_URL, query);
  if (!res.ok) {
    throw new Error(`IGDB metadata fetch failed: ${res.status}`);
  }
  const games = (await res.json()) as IgdbMetadataGame[];
  const [game] = games;
  if (!game) return null;
  const detail = detailGameToDto(game);
  if (!detail) return null;
  detail.timeToBeat = await fetchTimeToBeat(game.id);
  return detail;
}
