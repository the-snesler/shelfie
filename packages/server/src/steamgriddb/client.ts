import type { CoverShape } from "@shelfie/shared";

const SGDB_BASE_URL = "https://www.steamgriddb.com/api/v2";

/** SteamGridDB publishes no rate limit; stay polite like the TMDB client. */
const MIN_REQUEST_INTERVAL_MS = 100;
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

/** Optional: without a key every cover falls back to IGDB art. */
export function isSteamGridDbConfigured(): boolean {
  return Boolean(process.env.STEAMGRIDDB_API_KEY);
}

/** Grid dimensions per shape bucket (the API rejects any other value). */
const SHAPE_DIMENSIONS: Record<CoverShape, string> = {
  square: "512x512,1024x1024",
  iso: "342x482,660x930",
  tall: "600x900",
};

/** `no_logo` art drops the title, which a box cover should show. */
const GRID_STYLES = "alternate,white_logo,material,blurred";

export interface SgdbGame {
  id: number;
  name: string;
  /** epoch seconds; absent for many non-Steam games */
  release_date?: number | null;
}

export interface SgdbGrid {
  url: string;
  thumb: string;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

/** GETs an API path; 404 ("Game not found") → null, other failures throw so
 *  callers skip caching a transient miss. */
async function sgdbGet<T>(
  path: string,
  params?: Record<string, string>,
  retried = false,
): Promise<T | null> {
  await throttle();
  const url = new URL(`${SGDB_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.STEAMGRIDDB_API_KEY ?? ""}`,
      accept: "application/json",
    },
  });
  if (res.status === 429 && !retried) {
    const retryAfter = Number(res.headers.get("retry-after"));
    await delay(
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000,
    );
    return sgdbGet(path, params, true);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`SteamGridDB request failed (${res.status})`);
  }
  const body = (await res.json()) as Envelope<T>;
  if (!body.success) {
    throw new Error(
      `SteamGridDB request failed: ${(body.errors ?? []).join(", ")}`,
    );
  }
  return body.data ?? null;
}

export async function searchSgdbGames(name: string): Promise<SgdbGame[]> {
  return (
    (await sgdbGet<SgdbGame[]>(
      `/search/autocomplete/${encodeURIComponent(name)}`,
    )) ?? []
  );
}

export async function fetchSgdbGameBySteamAppId(
  appId: number,
): Promise<SgdbGame | null> {
  return sgdbGet<SgdbGame>(`/games/steam/${appId}`);
}

/** Top-ranked static, SFW grid in a shape bucket, or null when it has none.
 *  SteamGridDB returns grids in its own curated order (`score` is always 0). */
export async function fetchTopSgdbGrid(
  sgdbGameId: number,
  shape: CoverShape,
): Promise<SgdbGrid | null> {
  const grids = await sgdbGet<SgdbGrid[]>(`/grids/game/${sgdbGameId}`, {
    dimensions: SHAPE_DIMENSIONS[shape],
    styles: GRID_STYLES,
    types: "static",
    nsfw: "false",
    humor: "false",
  });
  return grids?.[0] ?? null;
}
