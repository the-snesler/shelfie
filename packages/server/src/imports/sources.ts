import {
  IMPORT_SOURCE_CAPABILITIES,
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
import type {
  EntryFilter,
  ImportAdapter,
  ImportedItem,
  SourceConfig,
  SourceData,
} from "./types.js";

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
/** The later of two optional ISO days. */
function latestDay(a: string | undefined, b: string | undefined) {
  return a && b ? (a > b ? a : b) : (a ?? b);
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

/**
 * Redirects are never followed, so a source cannot forward a saved
 * credential elsewhere. The error names the target (scheme, host and path
 * only) because the usual cause is an http:// URL for an https:// server.
 */
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
      redirect: "manual",
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
      `[imports] ${describeUrl(url)} -> request did not complete: ${reason}`,
    );
    throw new Error(
      "Source request could not complete. Check the server's network access and the source URL; server logs have details.",
      { cause: error },
    );
  }
  if (response.status >= 300 && response.status < 400) {
    let target = "another address";
    try {
      const next = new URL(response.headers.get("location") ?? "", url);
      target = `${next.protocol}//${next.host}${next.pathname}`;
    } catch {
      // A missing or malformed Location still gets the generic message.
    }
    console.warn(
      `[imports] ${describeUrl(url)} -> ${response.status} redirect to ${target} (not followed)`,
    );
    throw new Error(
      `Source redirected to ${target}. Use that address in the connection settings.`,
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

/** `wants` defaults to accepting everything; the service passes the policy. */
export function fetchSource(
  source: ImportSource,
  config: SourceConfig,
  deps = sourceDefaults,
  wants: EntryFilter = () => true,
): Promise<SourceData> {
  return IMPORT_ADAPTERS[source].fetch(config, deps, wants);
}

async function fetchSteam(
  config: SourceConfig,
  deps: SourceDependencies,
  wants: EntryFilter,
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
  let filtered = 0;
  for (const raw of response.games) {
    const game = object(raw);
    const minutes =
      typeof game.playtime_forever === "number"
        ? Math.max(0, game.playtime_forever)
        : 0;
    const status: ItemStatus =
      Number(game.playtime_2weeks) > 0
        ? "active"
        : minutes > 0
          ? "paused"
          : "backlogged";
    const lastPlayed = Number(game.rtime_last_played);
    const activityDay =
      Number.isSafeInteger(lastPlayed) && lastPlayed > 0
        ? new Date(lastPlayed * 1000).toISOString().slice(0, 10)
        : undefined;
    // Before the IGDB lookup: a large library is mostly unplayed games.
    if (!wants({ mediaType: "game", status, activityDay })) {
      filtered++;
      continue;
    }
    const app = numericId(game.appid);
    const id = app ? await deps.steamId(Number(app)) : null;
    if (!id) {
      skipped++;
      continue;
    }
    items.push({
      mediaType: "game",
      sourceId: String(id),
      ...(typeof game.name === "string" ? { title: game.name } : {}),
      ...(activityDay ? { activityDay } : {}),
      platforms: ["PC (Microsoft Windows)"],
      storefront: "steam",
      status,
      progressFormat: "hours",
      progressValue: Math.round((minutes / 60) * 100) / 100,
    });
  }
  return {
    items,
    skipped,
    filtered,
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
  async function* pages(path: string): AsyncGenerator<unknown[]> {
    for (let page = 1; page <= 100; page++) {
      const url = new URL(
        `https://api.trakt.tv/users/${encodeURIComponent(config.account)}/${path}`,
      );
      url.search = new URLSearchParams({
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
  let missingIds = 0;
  let partRatings = 0;
  let unwatchedRatings = 0;
  // History wins over watchlist state. Ratings come last and only rate
  // titles already found: like Trakt, a rating alone is neither a watch nor
  // a plan.
  for (const kind of ["watchlist", "history", "ratings"] as const) {
    for await (const data of pages(kind)) {
      for (const raw of data) {
        const entry = object(raw);
        if (
          kind === "ratings" &&
          entry.type !== "movie" &&
          entry.type !== "show"
        ) {
          // Episode/season ratings: Shelfie rates whole titles only.
          partRatings++;
          continue;
        }
        const mediaType =
          entry.type === "movie" || entry.movie ? "movie" : "tv";
        const catalog = object(
          mediaType === "movie" ? entry.movie : entry.show,
        );
        const id = numericId(object(catalog.ids).tmdb);
        if (!id) {
          missingIds++;
          continue;
        }
        const key = `${mediaType}:${id}`;
        if (kind === "ratings" && !items.has(key)) {
          unwatchedRatings++;
          continue;
        }
        // Movies and TV plan with "backlogged" (Watchlist); they never expose
        // "wishlisted" (client `STATUSES_BY_MEDIA`).
        const item: ImportedItem = items.get(key) ?? {
          mediaType,
          sourceId: id,
          status: "backlogged",
          ...(typeof catalog.title === "string"
            ? { title: catalog.title }
            : {}),
        };
        if (kind === "watchlist") {
          const listed = day(entry.listed_at);
          if (listed) item.activityDay = latestDay(item.activityDay, listed);
        }
        const score = rating(entry.rating, 2);
        if (score) item.rating = score;
        if (kind === "history") {
          const watched = day(entry.watched_at);
          if (watched) item.activityDay = latestDay(item.activityDay, watched);
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
            // Whether the show is finished is decided against TMDB's episode
            // data by the TV progress pass the import service runs next.
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
  const warnings: string[] = [];
  if (missingIds)
    warnings.push(
      `${missingIds} Trakt entries without a TMDB identifier were skipped.`,
    );
  if (partRatings)
    warnings.push(
      `${partRatings} episode or season ratings were skipped; Shelfie rates whole titles.`,
    );
  if (unwatchedRatings)
    warnings.push(
      `${unwatchedRatings} Trakt ratings were skipped because the title is neither watched nor on your watchlist.`,
    );
  return {
    items: [...items.values()],
    skipped: missingIds + partRatings + unwatchedRatings,
    warnings,
  };
}

/**
 * The server root, also accepting a pasted API, KOReader sync or docs URL
 * (`…/api/v1`, `…/api/v1/koreader`, `…/api/docs`).
 */
export function bookOrbitRoot(baseUrl: string): string {
  return baseUrl
    .replace(/\/+$/, "")
    .replace(/\/api(?:\/v1(?:\/koreader)?|\/docs(?:-json)?)?$/, "");
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
/** Read outcomes that count as finishing the book. */
const BOOKORBIT_FINISHED_OUTCOMES = new Set(["completed", "skimmed"]);
/** BookOrbit's maximum page size for both the book query and reading history. */
const BOOKORBIT_PAGE_SIZE = 200;
const BOOKORBIT_MAX_PAGES = 10_000 / BOOKORBIT_PAGE_SIZE;
/** Consecutive Goodreads failures before a run stops matching new books. */
const MAX_LOOKUP_FAILURES = 3;

/** BookOrbit sometimes stores a Goodreads URL slug ("68494.Perdido_Street_Station"). */
function goodreadsLegacyId(value: unknown): number | null {
  const id = numericId(/^\d+/.exec(String(value ?? ""))?.[0]);
  return id ? Number(id) : null;
}

/**
 * Finish days per BookOrbit book from its reading history. Reads without
 * any reading session were marked read by hand, often in bulk when a
 * library was set up, so their day records the marking rather than the
 * finish and is left out.
 */
async function bookOrbitFinishDays(
  api: string,
  headers: Record<string, string>,
  deps: SourceDependencies,
): Promise<Map<string, string[]>> {
  const days = new Map<string, string[]>();
  for (let page = 0; ; page++) {
    if (page === BOOKORBIT_MAX_PAGES)
      throw new Error("BookOrbit reading history exceeds 10,000 reads.");
    const { data } = await deps.request(
      `${api}/reading-history?offset=${page * BOOKORBIT_PAGE_SIZE}&limit=${BOOKORBIT_PAGE_SIZE}`,
      { headers },
    );
    const response = object(data);
    if (!Array.isArray(response.items))
      throw new Error("BookOrbit returned an invalid reading history page.");
    for (const raw of response.items) {
      const read = object(raw);
      const bookId = numericId(read.bookId);
      const ended = day(read.endedOn);
      if (
        !bookId ||
        !ended ||
        !BOOKORBIT_FINISHED_OUTCOMES.has(String(read.outcome)) ||
        !(Number(read.sessions) > 0)
      )
        continue;
      // Two reads can end the same day (a reread finished on another device).
      const known = days.get(bookId) ?? [];
      if (!known.includes(ended)) days.set(bookId, [...known, ended]);
    }
    if (
      response.items.length < BOOKORBIT_PAGE_SIZE ||
      (typeof response.total === "number" &&
        (page + 1) * BOOKORBIT_PAGE_SIZE >= response.total)
    )
      return days;
  }
}

/**
 * Reads BookOrbit through its official API with a user API key: the book
 * query for status, progress and rating, and reading history for finish
 * days. Books carry no Goodreads id in the list, so new books are matched
 * through `deps.books`, loading a book's detail (its Goodreads id and ISBN)
 * only when it has no saved match.
 */
async function fetchBookOrbit(
  config: SourceConfig,
  deps: SourceDependencies,
  wants: EntryFilter,
): Promise<SourceData> {
  const matcher = deps.books;
  if (!matcher) throw new Error("BookOrbit import needs a Goodreads matcher.");
  const api = `${bookOrbitRoot(config.baseUrl)}/api/v1`;
  const headers = {
    authorization: `Bearer ${config.apiKey}`,
    accept: "application/json",
  };
  // Checks the key before paging the library and names the account.
  const me = object((await deps.request(`${api}/auth/me`, { headers })).data);
  const account = typeof me.username === "string" ? me.username : "";
  const finishDays = await bookOrbitFinishDays(api, headers, deps);
  const items: ImportedItem[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let filtered = 0;
  let unmatched = 0;
  let pending = 0;
  let failures = 0;
  for (let page = 0; ; page++) {
    if (page === BOOKORBIT_MAX_PAGES)
      throw new Error("BookOrbit import exceeds the 10,000-item limit.");
    const { data } = await deps.request(`${api}/books/query`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      // Undocumented: BookOrbit ignores top-level page/size keys.
      body: JSON.stringify({
        pagination: { page, size: BOOKORBIT_PAGE_SIZE },
      }),
    });
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
      // Pages are ordered by title, so an edit mid-run can repeat a book.
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      const authors = Array.isArray(card.authors)
        ? card.authors.filter(
            (name): name is string => typeof name === "string",
          )
        : [];
      // Books never opened have no progress (null) rather than 0%.
      const rounded =
        typeof card.readingProgress === "number"
          ? Math.min(100, Math.round(card.readingProgress))
          : 0;
      const progress = rounded > 0 ? rounded : null;
      const readStatus = object(card.readStatus);
      const status =
        BOOKORBIT_STATUSES[String(readStatus.status)] ??
        (progress ? "active" : "backlogged");
      const completedDates = finishDays.get(externalId);
      const activityDay = latestDay(
        completedDates?.toSorted().at(-1),
        day(readStatus.updatedAt),
      );
      // Before matching: Goodreads lookups are throttled to one a second.
      if (!wants({ mediaType: "book", status, activityDay })) {
        filtered++;
        continue;
      }
      const book = { externalId, title, authors };
      let match: BookMatch | undefined;
      if (failures >= MAX_LOOKUP_FAILURES) {
        // Matched books still import while Goodreads is unavailable.
        match = await matcher.known(book);
      } else {
        try {
          match = await matcher.match(book, async () => {
            const detail = object(
              (await deps.request(`${api}/books/${externalId}`, { headers }))
                .data,
            );
            const isbn = detail.isbn13 ?? detail.isbn10 ?? card.isbn13;
            return {
              goodreadsId: goodreadsLegacyId(
                object(detail.providerIds).goodreads,
              ),
              isbn: typeof isbn === "string" ? isbn : null,
            };
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
      items.push({
        mediaType: "book",
        sourceId: String(goodreadsId),
        title,
        ...(activityDay ? { activityDay } : {}),
        status,
        rating: rating(card.rating),
        progressFormat: "percent",
        progressValue: progress,
        ...(completedDates ? { completedDates } : {}),
      });
    }
    if (
      response.items.length < BOOKORBIT_PAGE_SIZE ||
      (typeof response.total === "number" &&
        (page + 1) * BOOKORBIT_PAGE_SIZE >= response.total)
    )
      break;
  }
  const warnings: string[] = [];
  if (unmatched)
    warnings.push(
      `${unmatched} BookOrbit books have no Goodreads match. Link them under Book matches.`,
    );
  if (pending)
    warnings.push(
      `${pending} BookOrbit books could not be matched because Goodreads lookups failed. They will be retried on the next run.`,
    );
  return {
    items,
    skipped: skipped + unmatched + pending,
    filtered,
    warnings,
    ...(account ? { account } : {}),
  };
}

export const IMPORT_ADAPTERS: {
  [S in ImportSource]: ImportAdapter<SourceDependencies>;
} = {
  steam: {
    capabilities: IMPORT_SOURCE_CAPABILITIES.steam,
    normalizeConfig(next) {
      if (!/^\d{17}$/.test(next.account) || !next.apiKey)
        throw new Error("Steam needs a 17-digit SteamID64 and Web API key.");
      return next;
    },
    fetch: fetchSteam,
  },
  trakt: {
    capabilities: IMPORT_SOURCE_CAPABILITIES.trakt,
    normalizeConfig(next) {
      if (!/^[a-zA-Z0-9_-]+$/.test(next.account) || !next.apiKey)
        throw new Error("Trakt needs a profile slug and API client ID.");
      return next;
    },
    fetch: fetchTrakt,
  },
  bookorbit: {
    capabilities: IMPORT_SOURCE_CAPABILITIES.bookorbit,
    normalizeConfig(next, previous) {
      let url: URL;
      try {
        url = new URL(bookOrbitRoot(next.baseUrl));
      } catch (error) {
        throw new Error("Enter the BookOrbit server URL.", { cause: error });
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !next.apiKey
      )
        throw new Error("BookOrbit needs an HTTP(S) server URL and API key.");
      const baseUrl = bookOrbitRoot(next.baseUrl);
      // Pasting the whole header value is a common slip.
      const apiKey = next.apiKey.replace(/^Bearer\s+/i, "");
      return {
        baseUrl,
        apiKey,
        // The account is the key's user, reported by the next import; keep
        // it only while the server and key are unchanged.
        account:
          apiKey !== previous.apiKey || baseUrl !== previous.baseUrl
            ? ""
            : previous.account,
        // Bearer tokens from earlier BookOrbit adapters are no longer used.
        accessToken: "",
      };
    },
    fetch: fetchBookOrbit,
  },
};
