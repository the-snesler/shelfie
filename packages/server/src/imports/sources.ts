import { episodeKey, type ImportSource, type ItemStatus } from "@shelfie/shared";
import { findGameIdBySteamAppId } from "../igdb/client.js";
import type { ImportedItem, SourceConfig, SourceData } from "./types.js";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const numericId = (value: unknown): string | null => /^(?:[1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? String(value) : null;
function day(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const iso = value.slice(0, 10);
  const parsed = new Date(iso);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : undefined;
}
function rating(value: unknown, divisor = 1): number | undefined {
  return typeof value === "number" && value > 0 && value / divisor <= 5 ? Math.max(0.5, Math.round(value / divisor * 2) / 2) : undefined;
}

/** Redirects are rejected so a source cannot forward a saved credential elsewhere. */
export async function sourceJson(url: string | URL, init: RequestInit = {}): Promise<{ data: unknown; headers: Headers }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (!response.ok) throw new Error(`Source request failed (${response.status}). Check the connection credentials and profile visibility.`);
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 10_000_000) {
          await reader.cancel();
          throw new Error("Source response exceeds the import size limit.");
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try { return { data: JSON.parse(text), headers: response.headers }; }
  catch (error) { throw new Error("Source returned invalid JSON.", { cause: error }); }
}

export interface SourceDependencies {
  request: typeof sourceJson;
  steamId: typeof findGameIdBySteamAppId;
}
const defaults: SourceDependencies = { request: sourceJson, steamId: findGameIdBySteamAppId };

export async function fetchSource(source: ImportSource, config: SourceConfig, deps = defaults): Promise<SourceData> {
  if (source === "steam") return fetchSteam(config, deps);
  if (source === "bookorbit") return fetchBookOrbit(config, deps);
  return fetchTrakt(config, deps);
}

async function fetchSteam(config: SourceConfig, deps: SourceDependencies): Promise<SourceData> {
  const url = new URL("https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/");
  url.search = new URLSearchParams({ key: config.apiKey, steamid: config.account, include_appinfo: "1", include_played_free_games: "1", format: "json" }).toString();
  const { data } = await deps.request(url);
  const response = object(object(data).response);
  if (!Array.isArray(response.games)) throw new Error("Steam returned no game library. Make your profile and game details public.");
  if (response.games.length > 10_000) throw new Error("Steam library exceeds the 10,000-item limit.");
  const items: ImportedItem[] = [];
  let skipped = 0;
  for (const raw of response.games) {
    const game = object(raw);
    const app = numericId(game.appid);
    const id = app ? await deps.steamId(Number(app)) : null;
    if (!id) { skipped++; continue; }
    const minutes = typeof game.playtime_forever === "number" ? Math.max(0, game.playtime_forever) : 0;
    items.push({ mediaType: "game", sourceId: String(id), platforms: ["PC (Microsoft Windows)"], status: Number(game.playtime_2weeks) > 0 ? "active" : minutes > 0 ? "paused" : "backlogged", progressFormat: "hours", progressValue: Math.round(minutes / 60 * 100) / 100 });
  }
  return { items, skipped, warnings: skipped ? [`${skipped} Steam apps had no exact IGDB match and were skipped.`] : [] };
}

async function fetchTrakt(config: SourceConfig, deps: SourceDependencies): Promise<SourceData> {
  const headers: Record<string, string> = { "trakt-api-version": "2", "trakt-api-key": config.apiKey };
  if (config.accessToken) headers.Authorization = `Bearer ${config.accessToken}`;
  const items = new Map<string, ImportedItem>();
  let skipped = 0;
  // History wins over watchlist state. Ratings add missing items as planned.
  for (const kind of ["watchlist", "ratings", "history"] as const) {
    for (let page = 1; page <= 100; page++) {
      const url = new URL(`https://api.trakt.tv/users/${encodeURIComponent(config.account)}/${kind}`);
      url.search = new URLSearchParams({ page: String(page), limit: "100" }).toString();
      const { data, headers: pagination } = await deps.request(url, { headers });
      if (!Array.isArray(data)) throw new Error("Trakt returned an invalid collection.");
      for (const raw of data) {
        const entry = object(raw);
        if (kind === "ratings" && entry.type !== "movie" && entry.type !== "show") { skipped++; continue; }
        const mediaType = entry.type === "movie" || entry.movie ? "movie" : "tv";
        const catalog = object(mediaType === "movie" ? entry.movie : entry.show);
        const id = numericId(object(catalog.ids).tmdb);
        if (!id) { skipped++; continue; }
        const key = `${mediaType}:${id}`;
        const item = items.get(key) ?? { mediaType, sourceId: id, status: "wishlisted" };
        const score = rating(entry.rating, 2);
        if (score) item.rating = score;
        if (kind === "history") {
          const watched = day(entry.watched_at);
          if (mediaType === "movie") {
            item.status = "finished";
            item.completedDates = [...new Set([...(item.completedDates ?? []), ...(watched ? [watched] : [])])].sort().slice(-100);
          } else {
            item.status = "active";
            const ep = object(entry.episode);
            if (Number.isInteger(ep.season) && Number(ep.season) >= 0 && Number(ep.season) <= 999 && Number.isInteger(ep.number) && Number(ep.number) > 0 && Number(ep.number) <= 9999) {
              const episode = episodeKey(Number(ep.season), Number(ep.number));
              item.watchedEpisodes ??= {};
              const existing = item.watchedEpisodes[episode];
              if (existing === undefined || (watched && watched < existing)) item.watchedEpisodes[episode] = watched ?? "";
            }
          }
        }
        items.set(key, item);
      }
      const pages = Number(pagination.get("x-pagination-page-count"));
      if ((pages > 0 && page >= pages) || data.length < 100) break;
      if (page === 100) throw new Error("Trakt import exceeds 10,000 rows per category. Narrow the source library.");
    }
  }
  return { items: [...items.values()], skipped, warnings: skipped ? [`${skipped} Trakt entries without a supported TMDB identifier were skipped.`] : [] };
}

async function fetchBookOrbit(config: SourceConfig, deps: SourceDependencies): Promise<SourceData> {
  const base = config.baseUrl.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${config.accessToken}`, "content-type": "application/json" };
  const items: ImportedItem[] = [];
  let skipped = 0;
  const statuses: Record<string, ItemStatus> = { unread: "backlogged", want_to_read: "wishlisted", reading: "active", rereading: "active", on_hold: "paused", read: "finished", skimmed: "finished", abandoned: "dropped" };
  for (let page = 0; page < 100; page++) {
    const { data } = await deps.request(`${base}/api/v1/books/query`, { method: "POST", headers, body: JSON.stringify({ pagination: { page, size: 100 }, sort: [{ field: "title", dir: "asc" }], collapseSeries: false }) });
    const response = object(data);
    if (!Array.isArray(response.items)) throw new Error("BookOrbit returned an invalid books page.");
    for (const raw of response.items) {
      const card = object(raw);
      const localId = numericId(card.id);
      if (!localId) { skipped++; continue; }
      const { data: detailData } = await deps.request(`${base}/api/v1/books/${localId}`, { headers });
      const detail = object(detailData);
      const id = numericId(object(detail.providerIds).goodreads ?? detail.goodreadsId);
      if (!id) { skipped++; continue; }
      const state = object(detail.readStatus ?? card.readStatus);
      const completed = day(state.finishedAt);
      const progress = typeof card.readingProgress === "number" ? Math.max(0, Math.min(100, Math.round(card.readingProgress))) : null;
      items.push({ mediaType: "book", sourceId: id, status: statuses[String(state.status)] ?? "backlogged", rating: rating(detail.rating), completedDates: completed ? [completed] : [], progressFormat: "percent", progressValue: progress });
    }
    if (response.items.length < 100 || (typeof response.total === "number" && (page + 1) * 100 >= response.total)) break;
    if (page === 99) throw new Error("BookOrbit import exceeds the 10,000-item limit.");
  }
  return { items, skipped, warnings: skipped ? [`${skipped} BookOrbit books without a Goodreads ID were skipped. Add the Goodreads provider ID in BookOrbit to import them.`] : [] };
}
