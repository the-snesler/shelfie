import type { BookDetail, BookSearchResult, BookSeries } from "@shelfie/shared";

const AUTOCOMPLETE_URL = "https://www.goodreads.com/book/auto_complete";
const GRAPHQL_URL =
  "https://kxbwmqov6jgg3daaamb744ycu4.appsync-api.us-east-1.amazonaws.com/graphql";

/**
 * liberated from Goodreads _app JS chunk and also Grimmory.
 */
const DEFAULT_APPSYNC_KEY = "da2-xpgsdydkbregjhpr6ejzqdhuwy";

/**
 * Goodreads (and its AppSync backend) get a single shared, sequential
 * throttle: min 1s spacing plus 200-500ms jitter, matching Grimmory's own
 * pacing but centralized into one queue instead of ad hoc sleeps.
 */
const MIN_REQUEST_INTERVAL_MS = 1000;

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

let requestQueue: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  const jitter = 200 + Math.random() * 300;
  const next = requestQueue.then(() => delay(MIN_REQUEST_INTERVAL_MS + jitter));
  requestQueue = next;
  return next;
}

/** Error raised for a hard AppSync auth failure (401/403) — the key is likely rotated; never retried. */
export class GoodreadsAuthError extends Error {
  constructor(status: number) {
    super(
      `Goodreads AppSync rejected the request with ${status}; the x-api-key is likely rotated. Set GOODREADS_APPSYNC_KEY to a fresh key.`,
    );
    this.name = "GoodreadsAuthError";
  }
}

/** Fetches through the shared throttle, retrying once on 429/5xx with backoff. Never retries 401/403. */
async function goodreadsFetch(
  input: string,
  init: RequestInit,
  attempt = 0,
): Promise<Response> {
  await throttle();
  const res = await fetch(input, init);
  if (res.status === 401 || res.status === 403) {
    throw new GoodreadsAuthError(res.status);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 1) {
    await delay(1000 * 2 ** attempt);
    return goodreadsFetch(input, init, attempt + 1);
  }
  return res;
}

interface GoodreadsAutocompleteAuthor {
  name?: string;
}

interface GoodreadsAutocompleteEntry {
  bookId?: string;
  workId?: string;
  title?: string;
  bookUrl?: string;
  imageUrl?: string;
  numPages?: number;
  avgRating?: string;
  author?: GoodreadsAutocompleteAuthor;
}

/**
 * Upgrades a Goodreads thumbnail (`..._SY75_...jpg`) to the full-res image by
 * stripping the `._SYnn_`/`._SXnn_` size segment. Falls back to the original
 * thumb URL if the pattern isn't found.
 */
function upgradeCoverUrl(thumbUrl: string | undefined): string | null {
  if (!thumbUrl) return null;
  const upgraded = thumbUrl.replace(/\._S[XY]\d+_(?=\.)/, "");
  return upgraded;
}

export async function searchBooks(q: string): Promise<BookSearchResult[]> {
  const url = `${AUTOCOMPLETE_URL}?format=json&q=${encodeURIComponent(q)}`;
  const res = await goodreadsFetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Goodreads search failed: ${res.status}`);
  }
  const entries = (await res.json()) as GoodreadsAutocompleteEntry[];
  const results: BookSearchResult[] = [];
  for (const entry of entries) {
    if (!entry.bookId) continue;
    const goodreadsId = Number(entry.bookId);
    if (!Number.isFinite(goodreadsId)) continue;
    results.push({
      goodreadsId,
      name: entry.title ?? "",
      authors: entry.author?.name ? [entry.author.name] : [],
      // Goodreads' bookUrl slug carries no publication year; not guessed.
      year: null,
      coverUrl: upgradeCoverUrl(entry.imageUrl),
      pageCount: entry.numPages ?? null,
    });
  }
  return results;
}

const GRAPHQL_QUERY = `
query getBookPageData($legacyBookId: Int!) {
  getBookByLegacyId(legacyId: $legacyBookId) {
    title
    description
    imageUrl
    primaryContributorEdge { node { name } }
    secondaryContributorEdges { node { name } }
    bookSeries { userPosition series { title } }
    bookGenres { genre { name } }
    details {
      numPages
      publicationTime
      publisher
      isbn13
      language { name }
    }
    work {
      stats { averageRating ratingsCount }
    }
  }
}
`;

interface GoodreadsContributorEdge {
  node?: { name?: string };
}

interface GoodreadsBookSeriesEntry {
  userPosition?: string;
  series?: { title?: string };
}

interface GoodreadsGenreEntry {
  genre?: { name?: string };
}

interface GoodreadsBookDetails {
  numPages?: number;
  publicationTime?: number;
  publisher?: string;
  isbn13?: string;
  language?: { name?: string };
}

interface GoodreadsWorkStats {
  averageRating?: number;
  ratingsCount?: number;
}

interface GoodreadsBookByLegacyId {
  title?: string;
  description?: string;
  imageUrl?: string;
  primaryContributorEdge?: GoodreadsContributorEdge;
  secondaryContributorEdges?: GoodreadsContributorEdge[];
  bookSeries?: GoodreadsBookSeriesEntry[];
  bookGenres?: GoodreadsGenreEntry[];
  details?: GoodreadsBookDetails;
  work?: { stats?: GoodreadsWorkStats };
}

interface GoodreadsGraphqlResponse {
  data?: { getBookByLegacyId?: GoodreadsBookByLegacyId | null };
  errors?: { message: string }[];
}

/** Strips HTML tags out of the raw Goodreads description (the only spot Grimmory touches HTML). */
function stripHtml(html: string | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .trim();
  return text.length > 0 ? text : null;
}

/** epoch ms (sometimes a float) -> ISO YYYY-MM-DD, UTC. */
function epochMsToIsoDate(epochMs: number | undefined): string | null {
  if (!epochMs) return null;
  const iso = new Date(epochMs).toISOString();
  return iso.slice(0, 10);
}

function extractAuthors(book: GoodreadsBookByLegacyId): string[] {
  const authors: string[] = [];
  const primary = book.primaryContributorEdge?.node?.name;
  if (primary) authors.push(primary);
  for (const edge of book.secondaryContributorEdges ?? []) {
    const name = edge.node?.name;
    if (name) authors.push(name);
  }
  return authors;
}

function extractSeries(book: GoodreadsBookByLegacyId): BookSeries | null {
  const [first] = book.bookSeries ?? [];
  if (!first?.series?.title) return null;
  return {
    name: first.series.title,
    position: first.userPosition ?? null,
  };
}

export async function fetchBookByLegacyId(
  legacyId: number,
): Promise<BookDetail | null> {
  const res = await goodreadsFetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "x-api-key": process.env.GOODREADS_APPSYNC_KEY ?? DEFAULT_APPSYNC_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operationName: "getBookPageData",
      variables: { legacyBookId: legacyId },
      query: GRAPHQL_QUERY,
    }),
  });
  if (!res.ok) {
    throw new Error(`Goodreads GraphQL fetch failed: ${res.status}`);
  }
  const payload = (await res.json()) as GoodreadsGraphqlResponse;
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(
      `Goodreads GraphQL error: ${payload.errors.map((e) => e.message).join("; ")}`,
    );
  }
  const book = payload.data?.getBookByLegacyId;
  if (!book) return null;

  const publicationDate = epochMsToIsoDate(book.details?.publicationTime);
  return {
    goodreadsId: legacyId,
    name: book.title ?? "",
    coverUrl: book.imageUrl ?? null,
    authors: extractAuthors(book),
    year: publicationDate ? Number(publicationDate.slice(0, 4)) : null,
    pageCount: book.details?.numPages ?? null,
    description: stripHtml(book.description),
    publisher: book.details?.publisher ?? null,
    publicationDate,
    isbn13: book.details?.isbn13 ?? null,
    series: extractSeries(book),
    genres: (book.bookGenres ?? [])
      .map((g) => g.genre?.name)
      .filter((name): name is string => Boolean(name)),
    avgRating: book.work?.stats?.averageRating ?? null,
    ratingsCount: book.work?.stats?.ratingsCount ?? null,
    language: book.details?.language?.name ?? null,
  };
}
