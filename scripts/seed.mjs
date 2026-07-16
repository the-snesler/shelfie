#!/usr/bin/env node
/**
 * Bootstraps a freshly-cloned Shelfie instance for local dev: claims the
 * owner password (so the app isn't stuck behind the setup wall) and adds a
 * handful of real games to the library, so a new worktree isn't a blank
 * slate.
 *
 * Games are resolved through the server's own /api/games/search (backed by
 * IGDB), so seeded items always have real cover art and metadata rather than
 * guessed-at ids. Requires IGDB_CLIENT_ID/IGDB_CLIENT_SECRET to be set (see
 * root .env) — a search miss is logged and skipped rather than failing the
 * whole run.
 *
 * Safe to re-run: the password step logs in instead of erroring once setup
 * is done, and re-seeding the same library item ids is a no-op (the sync
 * push endpoint treats an existing id as a conflict and skips it rather than
 * overwriting).
 *
 * Usage:   node scripts/seed.mjs
 * Env:     SHELFIE_SERVER_URL  default http://localhost:3001
 *          SHELFIE_PASSWORD    default "admin" (matches the dev convention)
 */

const SERVER_URL = process.env.SHELFIE_SERVER_URL ?? "http://localhost:3001";
const PASSWORD = process.env.SHELFIE_PASSWORD ?? "admin";

// query: title to search IGDB for. status/progress: seeded library item state.
const SEEDS = [
  {
    query: "The Legend of Zelda: Breath of the Wild",
    status: "playing",
    progress: 40,
  },
  { query: "Hollow Knight", status: "completed", progress: 100 },
  { query: "Elden Ring", status: "backlogged", progress: null },
  { query: "Stardew Valley", status: "wishlisted", progress: null },
  { query: "Celeste", status: "completed", progress: 100 },
  { query: "Splatoon Raiders", status: "playing", progress: 20 },
  { query: "Super Mario Galaxy", status: "completed", progress: 100 },
  { query: "Super Mario Sunshine", status: "backlogged", progress: null },
  { query: "Super Mario 64", status: "completed", progress: 100 },
];

async function main() {
  const token = await claimToken();

  const now = Date.now();
  let order = 0;
  // Step addedAt/updatedAt forward so seeded items don't all tie on the same
  // timestamp (the conflict handler and any future sort-by-added UI care).
  const at = () => now + order++ * 60_000;

  const items = [];
  for (const seed of SEEDS) {
    const igdbId = await searchGameId(seed.query, token);
    if (igdbId == null) {
      console.warn(`No IGDB match for "${seed.query}" — skipping.`);
      continue;
    }
    const ts = at();
    items.push({
      id: `game:${igdbId}`,
      mediaType: "game",
      sourceId: String(igdbId),
      status: seed.status,
      progress: seed.progress,
      platforms: [],
      addedAt: ts,
      updatedAt: ts,
      _deleted: false,
    });
  }

  if (items.length === 0) {
    throw new Error(
      "No games resolved via IGDB search — check IGDB_CLIENT_ID/IGDB_CLIENT_SECRET in .env.",
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

/** Looks up the top IGDB search hit for a title via the server's own search route. */
async function searchGameId(query, token) {
  const res = await fetch(
    `${SERVER_URL}/api/games/search?q=${encodeURIComponent(query)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const results = await res.json();
  return results[0]?.igdbId ?? null;
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
