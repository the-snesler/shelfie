#!/usr/bin/env node
/**
 * Regenerates the card metadata bundled with the guest demo shelf
 * (`packages/client/src/features/demo/demoCards.json`).
 *
 * Guests load the demo without touching the server: their card requests
 * share a ten-unit-per-minute anonymous quota, so fetching ~20 cards on
 * click would exhaust it. The fixture is captured once here, through the
 * owner's session, from the same `/api/<medium>?ids=` card routes the client
 * uses. Re-run it when titles change or metadata drifts noticeably.
 *
 * The ids must match `DEMO_ITEMS` in `features/demo/demoShelf.ts`;
 * `demoShelf.test.ts` fails if the two diverge.
 *
 * Usage:   node scripts/demo-fixture.mjs   (needs `pnpm dev` running)
 * Env:     SHELFIE_SERVER_URL / SERVER_PORT / SHELFIE_USERNAME /
 *          SHELFIE_PASSWORD, as for `scripts/seed.mjs`.
 */
import { writeFile } from "node:fs/promises";

const SERVER_URL =
  process.env.SHELFIE_SERVER_URL ??
  `http://localhost:${process.env.SERVER_PORT ?? process.env.PORT ?? 3001}`;
const USERNAME = process.env.SHELFIE_USERNAME ?? "owner";
const PASSWORD = process.env.SHELFIE_PASSWORD ?? "admin";
const OUT = new URL(
  "../packages/client/src/features/demo/demoCards.json",
  import.meta.url,
);

// IGDB ids for games, TMDB ids for movies/TV, Goodreads legacy ids for books.
const DEMO_IDS = {
  games: [7346, 14593, 119133, 26226, 17000, 251833, 52189, 228525],
  movies: [693134, 335984, 666277, 545611, 129],
  tv: [95396, 136315, 126308, 94605],
  books: [54493401, 5907, 50202953, 58784475, 18423],
};

async function main() {
  const token = await login();
  const fixture = {};
  for (const [medium, ids] of Object.entries(DEMO_IDS)) {
    const res = await fetch(
      `${SERVER_URL}/api/${medium}?ids=${ids.join(",")}`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) throw new Error(`/api/${medium} failed (${res.status})`);
    const cards = await res.json();
    if (cards.length !== ids.length) {
      throw new Error(
        `/api/${medium} returned ${cards.length} of ${ids.length} cards`,
      );
    }
    fixture[medium] = cards;
  }
  await writeFile(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`Wrote ${OUT.pathname}`);
}

async function login() {
  const res = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(
      `Login failed (${res.status}). Run \`pnpm seed\` first, or set SHELFIE_USERNAME/SHELFIE_PASSWORD.`,
    );
  }
  return (await res.json()).token;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
