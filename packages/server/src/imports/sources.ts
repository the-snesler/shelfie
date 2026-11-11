import {
  episodeKey,
  type ImportSource,
  type ItemStatus,
} from "@shelfie/shared";
import { findGameIdBySteamAppId } from "../igdb/client.js";
import {
  GoodreadsLookupError,
  type BookMatch,
  type BookMatcher,
} from "./bookLinks.js";
import type { ImportedItem, SourceConfig, SourceData } from "./types.js";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const numericId = (value: unknown): string | null =>
  /^(?:[1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(Number(value))
    ? String(value)
    : null;
function day(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const iso = value.slice(0, 10);
  // Trakt reports "watched, date unknown" as the Unix epoch.
  if (iso === "1970-01-01") return undefined;
  const parsed = new Date(iso);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === iso
    ? iso
    : undefined;
}
function rating(value: unknown, divisor = 1): number | undefined {
  return typeof value === "number" && value > 0 && value / divisor <= 5
    ? Math.max(0.5, Math.round((value / divisor) * 2) / 2)
    : undefined;
}

/**
 * Sent on every source request. Trakt's Cloudflare front rejects Node's
 * default `User-Agent: node` with a 403 challenge page before the request
 * reaches the API, which looks exactly like a bad API key.
 */
export const SOURCE_USER_AGENT =
  "Shelfie/1.0 (+https://github.com/the-snesler/shelfie)";

/**
 * Host + path only: query strings carry credentials (Steam's `key=`) and
 * userinfo may too, so neither may reach a stored error or a log line.
 */
function describeUrl(url: string | URL): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "the source";
  }
}

const STATUS_HINTS: Record<number, string> = {
  401: "authorization required: credentials missing/expired, or the profile is private",
  403: "credentials rejected: check the API key and profile visibility",
  404: "account or resource not found: check the account name/ID",
  429: "rate limited by the source",
};

/** Collapses a response body to one log-friendly line (HTML → its title + text). */
function bodySnippet(body: string, html: boolean): string {
  if (!html) return body.replace(/\s+/g, " ").trim().slice(0, 300);
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim();
  const text = body
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return title ? `[HTML "${title}"] ${text}` : `[HTML] ${text}`;
}

/**
 * Logs everything useful about a failed source response (never request
 * headers, which carry credentials) and returns the short user-facing error.
 */
async function sourceError(
  url: string | URL,
  response: Response,
): Promise<Error> {
  const type = response.headers.get("content-type") ?? "";
  const html = type.includes("text/html");
  let body = "";
  try {
    body = (await response.text()).slice(0, 8_000);
  } catch {
    // The status is still worth reporting without a body.
  }
  const server = response.headers.get("server");
  // An HTML page from a CDN means the request never reached the API, so the
  // credentials have not been checked yet.
  const blocked =
    response.headers.has("cf-mitigated") ||
    (html &&
      (server?.toLowerCase() === "cloudflare" ||
        /cloudflare|attention required|just a moment/i.test(body)));
  const diagnosis = blocked
    ? "blocked by Cloudflare bot protection before reaching the API (credentials were NOT checked); usually a missing/blocked User-Agent or a blocked server IP"
    : (STATUS_HINTS[response.status] ??
      (response.status >= 500
        ? "source-side error, try again later"
        : "unexpected response"));
  const meta = [
    `server=${server ?? "-"}`,
    `content-type=${type || "-"}`,
    response.headers.get("cf-ray") &&
      `cf-ray=${response.headers.get("cf-ray")}`,
    response.headers.get("retry-after") &&
      `retry-after=${response.headers.get("retry-after")}`,
  ].filter(Boolean);
  console.warn(
    `[imports] ${describeUrl(url)} -> ${response.status} ${response.statusText} (${meta.join(", ")}): ${diagnosis}` +
      (body ? `\n[imports]   body: ${bodySnippet(body, html)}` : ""),
  );
  return new Error(
    `Source request failed (${response.status}). Check the connection credentials and profile visibility; server logs have details.`,
  );
}

/** Redirects are rejected so a source cannot forward a saved credential elsewhere. */
export async function sourceJson(
  url: string | URL,
  init: RequestInit = {},
): Promise<{ data: unknown; headers: Headers }> {
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", SOURCE_USER_AGENT);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "timed out after 30s"
        : cause instanceof Error
          ? `${cause.name}: ${"code" in cause ? `${String(cause.code)} ` : ""}${cause.message}`
          : error instanceof Error
            ? error.message
            : String(error);
    console.warn(
      `[imports] ${describeUrl(url)} -> request did not complete: ${reason} (redirects are refused)`,
    );
    throw new Error(
      "Source request could not complete. Check the server's network access and the source URL; server logs have details.",
      { cause: error },
    );
  }
  if (!response.ok) throw await sourceError(url, response);
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
    } finally {
      reader.releaseLock();
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return { data: JSON.parse(text), headers: response.headers };
  } catch (error) {
    throw new Error("Source returned invalid JSON.", { cause: error });
  }
}

export interface SourceDependencies {
  request: typeof sourceJson;
  steamId: typeof findGameIdBySteamAppId;
  /** Matches source books to Goodreads IDs; required for BookOrbit. */
  books?: BookMatcher;
}
export const sourceDefaults: SourceDependencies = {
  request: sourceJson,
  steamId: findGameIdBySteamAppId,
};

export async function fetchSource(
  source: ImportSource,
  config: SourceConfig,
  deps = sourceDefaults,
): Promise<SourceData> {
  if (source === "steam") return fetchSteam(config, deps);
  if (source === "bookorbit") return fetchBookOrbit(config, deps);
  return fetchTrakt(config, deps);
}

async function fetchSteam(
  config: SourceConfig,
  deps: SourceDependencies,
): Promise<SourceData> {
  const url = new URL(
    "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/",
  );
  url.search = new URLSearchParams({
    key: config.apiKey,
    steamid: config.account,
    include_appinfo: "1",
    include_played_free_games: "1",
    format: "json",
  }).toString();
  const { data } = await deps.request(url);
  const response = object(object(data).response);
  if (!Array.isArray(response.games))
    throw new Error(
      "Steam returned no game library. Make your profile and game details public.",
    );
  if (response.games.length > 10_000)
    throw new Error("Steam library exceeds the 10,000-item limit.");
  const items: ImportedItem[] = [];
  let skipped = 0;
  for (const raw of response.games) {
    const game = object(raw);
    const app = numericId(game.appid);
    const id = app ? await deps.steamId(Number(app)) : null;
    if (!id) {
      skipped++;
      continue;
    }
    const minutes =
      typeof game.playtime_forever === "number"
        ? Math.max(0, game.playtime_forever)
        : 0;
    items.push({
      mediaType: "game",
      sourceId: String(id),
      platforms: ["PC (Microsoft Windows)"],
      status:
        Number(game.playtime_2weeks) > 0
          ? "active"
          : minutes > 0
            ? "paused"
            : "backlogged",
      progressFormat: "hours",
      progressValue: Math.round((minutes / 60) * 100) / 100,
    });
  }
  return {
    items,
    skipped,
    warnings: skipped
      ? [`${skipped} Steam apps had no exact IGDB match and were skipped.`]
      : [],
  };
}

async function fetchTrakt(
  config: SourceConfig,
  deps: SourceDependencies,
): Promise<SourceData> {
  const headers: Record<string, string> = {
    "trakt-api-version": "2",
    "trakt-api-key": config.apiKey,
  };
  if (config.accessToken)
    headers.Authorization = `Bearer ${config.accessToken}`;
  async function* pages(
    path: string,
    params: Record<string, string> = {},
  ): AsyncGenerator<unknown[]> {
    for (let page = 1; page <= 100; page++) {
      const url = new URL(
        `https://api.trakt.tv/users/${encodeURIComponent(config.account)}/${path}`,
      );
      url.search = new URLSearchParams({
        ...params,
        page: String(page),
        limit: "100",
      }).toString();
      const { data, headers: pagination } = await deps.request(url, {
        headers,
      });
      if (!Array.isArray(data))
        throw new Error("Trakt returned an invalid collection.");
      yield data;
      const count = Number(pagination.get("x-pagination-page-count"));
      if ((count > 0 && page >= count) || data.length < 100) return;
      if (page === 100)
        throw new Error(
          "Trakt import exceeds 10,000 rows per category. Narrow the source library.",
        );
    }
  }
  const items = new Map<string, ImportedItem>();
  let skipped = 0;
  // History wins over watchlist state. Ratings add missing items as planned.
  for (const kind of ["watchlist", "ratings", "history"] as const) {
    for await (const data of pages(kind)) {
      for (const raw of data) {
        const entry = object(raw);
        if (
          kind === "ratings" &&
          entry.type !== "movie" &&
          entry.type !== "show"
        ) {
          skipped++;
          continue;
        }
        const mediaType =
          entry.type === "movie" || entry.movie ? "movie" : "tv";
        const catalog = object(
          mediaType === "movie" ? entry.movie : entry.show,
        );
        const id = numericId(object(catalog.ids).tmdb);
        if (!id) {
          skipped++;
          continue;
        }
        const key = `${mediaType}:${id}`;
        // Movies and TV plan with "backlogged" (Watchlist); they never expose
        // "wishlisted" (client `STATUSES_BY_MEDIA`).
        const item = items.get(key) ?? {
          mediaType,
          sourceId: id,
          status: "backlogged",
        };
        const score = rating(entry.rating, 2);
        if (score) item.rating = score;
        if (kind === "history") {
          const watched = day(entry.watched_at);
          if (mediaType === "movie") {
            item.status = "finished";
            item.completedDates = [
              ...new Set([
                ...(item.completedDates ?? []),
                ...(watched ? [watched] : []),
              ]),
            ]
              .sort()
              .slice(-100);
          } else {
            item.status = "active";
            const ep = object(entry.episode);
            if (
              Number.isInteger(ep.season) &&
              Number(ep.season) >= 0 &&
              Number(ep.season) <= 999 &&
              Number.isInteger(ep.number) &&
              Number(ep.number) > 0 &&
              Number(ep.number) <= 9999
            ) {
              const episode = episodeKey(Number(ep.season), Number(ep.number));
              item.watchedEpisodes ??= {};
              const existing = item.watchedEpisodes[episode];
              if (existing === undefined || (watched && watched < existing))
                item.watchedEpisodes[episode] = watched ?? "";
            }
          }
        }
        items.set(key, item);
      }
    }
  }
  // History alone can't tell "watching" from "watched everything", so compare
  // against Trakt's aired count — the same rule the client applies when the
  // last episode is checked off (`deriveEpisodeWatch`), specials excluded.
  if ([...items.values()].some((item) => item.watchedEpisodes))
    for await (const data of pages("watched/shows", {
      extended: "full,noseasons",
    }))
      for (const raw of data) {
        const show = object(object(raw).show);
        const id = numericId(object(show.ids).tmdb);
        const item = id ? items.get(`tv:${id}`) : undefined;
        const aired = show.aired_episodes;
        if (!item?.watchedEpisodes || typeof aired !== "number" || aired <= 0)
          continue;
        const watched = Object.entries(item.watchedEpisodes).filter(
          ([key]) => !key.startsWith("s0e"),
        );
        if (watched.length < aired) continue;
        item.status = "finished";
        const last = watched
          .map(([, date]) => date)
          .filter(Boolean)
          .sort()
          .at(-1);
        if (last) item.completedDates = [last];
      }
  return {
    items: [...items.values()],
    skipped,
    warnings: skipped
      ? [
          `${skipped} Trakt entries without a supported TMDB identifier were skipped.`,
        ]
      : [],
  };
}

/** Accepts the KOReader sync URL BookOrbit shows as well as the server root. */
export function bookOrbitRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/api\/v1\/koreader$/, "");
}

const BOOKORBIT_STATUSES: Record<string, ItemStatus> = {
  unread: "backlogged",
  want_to_read: "wishlisted",
  reading: "active",
  rereading: "active",
  on_hold: "paused",
  read: "finished",
  skimmed: "finished",
  abandoned: "dropped",
};
/** Consecutive Goodreads failures before a run stops matching new books. */
const MAX_LOOKUP_FAILURES = 3;

/**
 * Reads BookOrbit through the catalog its KOReader plugin uses. KOReader sync
 * credentials do not expire, unlike web-session bearer tokens. The catalog has
 * no Goodreads IDs, so books are matched through `deps.books`.
 */
async function fetchBookOrbit(
  config: SourceConfig,
  deps: SourceDependencies,
): Promise<SourceData> {
  const matcher = deps.books;
  if (!matcher) throw new Error("BookOrbit import needs a Goodreads matcher.");
  const catalog = `${bookOrbitRoot(config.baseUrl)}/api/v1/koreader/plugin/catalog`;
  const headers = {
    "x-auth-user": config.account,
    "x-auth-key": config.apiKey,
    accept: "application/json",
  };
  const items: ImportedItem[] = [];
  let skipped = 0;
  let unmatched = 0;
  let pending = 0;
  let failures = 0;
  for (let page = 1; page <= 100; page++) {
    const { data } = await deps.request(
      `${catalog}/books?page=${page}&size=100&sort=title&order=asc`,
      { headers },
    );
    const response = object(data);
    if (!Array.isArray(response.items))
      throw new Error("BookOrbit returned an invalid books page.");
    for (const raw of response.items) {
      const card = object(raw);
      const externalId = numericId(card.id);
      const title = typeof card.title === "string" ? card.title : "";
      if (!externalId || !title) {
        skipped++;
        continue;
      }
      const authors = Array.isArray(card.authors)
        ? card.authors.filter(
            (name): name is string => typeof name === "string",
          )
        : [];
      const book = { externalId, title, authors };
      let detail: JsonObject | undefined;
      const loadDetail = async (): Promise<JsonObject> => {
        detail ??= object(
          (await deps.request(`${catalog}/books/${externalId}`, { headers }))
            .data,
        );
        return detail;
      };
      let match: BookMatch | undefined;
      if (failures >= MAX_LOOKUP_FAILURES) {
        // Matched books still import while Goodreads is unavailable.
        match = await matcher.known(book);
      } else {
        try {
          match = await matcher.match(book, async () => {
            const found = await loadDetail();
            const isbn = found.isbn13 ?? found.isbn10;
            return typeof isbn === "string" ? isbn : null;
          });
          failures = 0;
        } catch (error) {
          if (!(error instanceof GoodreadsLookupError)) throw error;
          failures++;
        }
      }
      if (!match) {
        pending++;
        continue;
      }
      const { goodreadsId } = match;
      if (goodreadsId === null) {
        if (match.method === "ignored") skipped++;
        else unmatched++;
        continue;
      }
      // 0% is BookOrbit's default for books never opened, not logged progress.
      const rounded =
        typeof card.progressPercentage === "number"
          ? Math.min(100, Math.round(card.progressPercentage))
          : 0;
      const progress = rounded > 0 ? rounded : null;
      const status =
        BOOKORBIT_STATUSES[String(card.readStatus)] ??
        (progress ? "active" : "backlogged");
      const lastRead = day(card.lastReadAt);
      // Personal ratings are only on the detail response; unread books are
      // left out so a routine run does not fetch the whole catalog.
      const tracked = card.readStatus != null && card.readStatus !== "unread";
      items.push({
        mediaType: "book",
        sourceId: String(goodreadsId),
        status,
        rating: tracked ? rating((await loadDetail()).rating) : undefined,
        progressFormat: "percent",
        progressValue: progress,
        ...(status === "finished" && lastRead
          ? { fallbackCompletedDate: lastRead }
          : {}),
      });
    }
    if (
      response.items.length < 100 ||
      response.hasNext === false ||
      (typeof response.total === "number" && page * 100 >= response.total)
    )
      break;
    if (page === 100)
      throw new Error("BookOrbit import exceeds the 10,000-item limit.");
  }
  const warnings: string[] = [];
  if (unmatched)
    warnings.push(
      `${unmatched} BookOrbit books have no Goodreads match. Link them under Book matches.`,
    );
  if (pending)
    warnings.push(
      `${pending} BookOrbit books could not be matched because Goodreads search failed. They will be retried on the next run.`,
    );
  return { items, skipped: skipped + unmatched + pending, warnings };
}
