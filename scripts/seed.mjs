#!/usr/bin/env node
/**
 * Bootstraps a freshly-cloned Shelfie instance for local dev: claims the
 * owner password (so the app isn't stuck behind the setup wall) and adds a
 * handful of real games, movies, TV shows, and books to the library, so a
 * new worktree isn't a blank slate.
 *
 * Items are resolved through the server's own search routes (IGDB for games,
 * TMDB for movies/TV, Goodreads for books), so seeded items always have real
 * cover art and metadata rather than guessed-at ids. Requires
 * IGDB_CLIENT_ID/IGDB_CLIENT_SECRET and TMDB_TOKEN to be set (see root .env)
 * — a search miss is logged and skipped rather than failing the whole run.
 *
 * Safe to re-run: the password step logs in instead of erroring once setup
 * is done, and re-seeding the same library item ids is a no-op (the sync
 * push endpoint treats an existing id as a conflict and skips it rather than
 * overwriting).
 *
 * Usage:   node scripts/seed.mjs
 * Env:     SHELFIE_SERVER_URL  full override, default derived from SERVER_PORT
 *          SERVER_PORT         default 3001 (matches packages/server's own default;
 *                              set alongside CLIENT_PORT to run several dev
 *                              stacks — e.g. one per agent — in parallel)
 *          SHELFIE_PASSWORD    default "admin" (matches the dev convention)
 */

const SERVER_URL =
  process.env.SHELFIE_SERVER_URL ??
  `http://localhost:${process.env.SERVER_PORT ?? process.env.PORT ?? 3001}`;
const PASSWORD = process.env.SHELFIE_PASSWORD ?? "admin";

// mediaType+query: what to search for. status/progressFormat/progressValue:
// seeded library item state. watchedEpisodes: TV-only episode keys.
const SEEDS = [
  {
    mediaType: "game",
    query: "The Legend of Zelda: Breath of the Wild",
    status: "active",
    progressFormat: "hours",
    progressValue: 24,
  },
  {
    mediaType: "game",
    query: "Hollow Knight",
    status: "completed",
    progressFormat: "percent",
    progressValue: 100,
  },
  {
    mediaType: "game",
    query: "Elden Ring",
    status: "backlogged",
    progressFormat: "hours",
    progressValue: null,
  },
  {
    mediaType: "game",
    query: "Stardew Valley",
    status: "wishlisted",
    progressFormat: "hours",
    progressValue: null,
  },
  {
    mediaType: "game",
    query: "Celeste",
    status: "completed",
    progressFormat: "percent",
    progressValue: 100,
  },
  {
    mediaType: "game",
    query: "Splatoon Raiders",
    status: "active",
    progressFormat: "hours",
    progressValue: 12,
  },
  {
    mediaType: "game",
    query: "Super Mario Galaxy",
    status: "completed",
    progressFormat: "percent",
    progressValue: 100,
  },
  {
    mediaType: "game",
    query: "Super Mario Sunshine",
    status: "backlogged",
    progressFormat: "hours",
    progressValue: null,
  },
  {
    mediaType: "game",
    query: "Super Mario 64",
    status: "completed",
    progressFormat: "percent",
    progressValue: 100,
  },
  {
    mediaType: "movie",
    query: "Dune",
    status: "finished",
    progressFormat: "percent",
    progressValue: null,
  },
  {
    mediaType: "movie",
    query: "Blade Runner 2049",
    status: "backlogged",
    progressFormat: "percent",
    progressValue: null,
  },
  {
    mediaType: "tv",
    query: "Breaking Bad",
    status: "active",
    progressFormat: "percent",
    progressValue: null,
    watchedEpisodes: ["s1e1", "s1e2", "s1e3", "s1e4"],
  },
  {
    mediaType: "tv",
    query: "Severance",
    status: "backlogged",
    progressFormat: "percent",
    progressValue: null,
  },
  {
    mediaType: "book",
    query: "Project Hail Mary",
    status: "active",
    progressFormat: "pages",
    progressValue: 210,
  },
  {
    mediaType: "book",
    query: "The Hobbit",
    status: "finished",
    progressFormat: "pages",
    progressValue: null,
  },
];

// Per-media search route and the id field its results carry.
const SEARCH_BY_MEDIA = {
  game: { path: "/api/games/search", idField: "igdbId" },
  movie: { path: "/api/movies/search", idField: "tmdbId" },
  tv: { path: "/api/tv/search", idField: "tmdbId" },
  book: { path: "/api/books/search", idField: "goodreadsId" },
};

async function main() {
  const token = await claimToken();

  const now = Date.now();
  let order = 0;
  // Step addedAt/updatedAt forward so seeded items don't all tie on the same
  // timestamp (the conflict handler and any future sort-by-added UI care).
  const at = () => now + order++ * 60_000;

  const items = [];
  for (const seed of SEEDS) {
    const sourceId = await searchSourceId(seed.mediaType, seed.query, token);
    if (sourceId == null) {
      console.warn(
        `No ${seed.mediaType} match for "${seed.query}" — skipping.`,
      );
      continue;
    }
    const ts = at();
    items.push({
      id: `${seed.mediaType}:${sourceId}`,
      mediaType: seed.mediaType,
      sourceId: String(sourceId),
      status: seed.status,
      progressFormat: seed.progressFormat,
      progressValue: seed.progressValue,
      platforms: [],
      rating: null,
      completedDates: [],
      notes: "",
      watchedEpisodes: seed.watchedEpisodes ?? [],
      addedAt: ts,
      updatedAt: ts,
      _deleted: false,
    });
  }

  if (items.length === 0) {
    throw new Error(
      "No items resolved via search — check IGDB_CLIENT_ID/IGDB_CLIENT_SECRET and TMDB_TOKEN in .env.",
    );
  }

  const result = await push("library_items", items, token);
  console.log(
    `Library items: ${result.written} written, ${result.skipped} already present.`,
  );
  console.log(`Log in with password: ${PASSWORD}`);
}

/** Claims the owner password on first run, or logs in on subsequent runs. */
async function claimToken() {
  const status = await getJson("/api/auth/status");
  const path = status.setupRequired ? "/api/auth/setup" : "/api/auth/login";
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const hint = status.setupRequired
      ? `Setup failed (${res.status}): ${detail}`
      : `Login failed (${res.status}) — the owner password isn't "${PASSWORD}". ` +
        `Set SHELFIE_PASSWORD to match it, or wipe packages/server/data to start over. ${detail}`;
    throw new Error(hint);
  }
  return (await res.json()).token;
}

/** Looks up the top search hit's source id via the server's own search routes. */
async function searchSourceId(mediaType, query, token) {
  const { path, idField } = SEARCH_BY_MEDIA[mediaType];
  const res = await fetch(`${SERVER_URL}${path}?q=${encodeURIComponent(query)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const results = await res.json();
  return results[0]?.[idField] ?? null;
}

/** Pushes docs through the same sync/push endpoint the client uses. */
async function push(collection, docs, token) {
  const rows = docs.map((doc) => ({
    newDocumentState: doc,
    assumedMasterState: null,
  }));
  const res = await fetch(`${SERVER_URL}/api/sync/${collection}/push`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(
      `Push to ${collection} failed (${res.status}): ${await res.text()}`,
    );
  }
  // The endpoint returns the docs it *didn't* write (already-present conflicts).
  const conflicts = await res.json();
  return { written: docs.length - conflicts.length, skipped: conflicts.length };
}

async function getJson(path) {
  const res = await fetch(`${SERVER_URL}${path}`);
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return res.json();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  console.error(
    `\nIs the server running? Try \`pnpm dev\` first (expected at ${SERVER_URL}).`,
  );
  process.exitCode = 1;
});
