#!/usr/bin/env node
/**
 * Opens the running Shelfie client in headless Chromium, logs in if needed,
 * and saves a screenshot — so an agent doesn't have to hand-roll Playwright
 * just to see what's on screen after a change.
 *
 * Expects the dev server (and ideally `scripts/seed.mjs`) to already be
 * running; this only drives the browser.
 *
 * Usage:   node scripts/screenshot.mjs [output-path]
 * Env:     SHELFIE_CLIENT_URL  full override, default derived from CLIENT_PORT
 *          CLIENT_PORT         default 5173 (matches packages/client's own default;
 *                              set alongside SERVER_PORT to run several dev
 *                              stacks — e.g. one per agent — in parallel)
 *          SHELFIE_PASSWORD    default "admin" (matches the dev convention)
 */

import { chromium } from "playwright";

const CLIENT_URL =
  process.env.SHELFIE_CLIENT_URL ??
  `http://localhost:${process.env.CLIENT_PORT ?? 5173}`;
const PASSWORD = process.env.SHELFIE_PASSWORD ?? "admin";
const OUTPUT_PATH = process.argv[2] ?? "scripts/screenshot.png";
const EMPTY_STATE_TEXT = /your library is empty/i;
// How long to keep waiting for a library item after the empty state shows. A
// fresh profile flashes "empty" for a beat before its first replication pull
// lands, then the app swaps in the synced items on its own. This grace gives
// that self-heal time to happen; a genuinely empty library just rides it out
// and screenshots empty.
const SELF_HEAL_GRACE_MS = 4000;

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });

    // Shelfie opens an SSE connection for the library_items collection as soon
    // as it's authed, which never goes idle — so "networkidle" would hang.
    // "load" plus explicit element waits is the reliable signal here.
    await page.goto(CLIENT_URL, { waitUntil: "load" });
    await login(page);
    await waitForLibraryToSettle(page);

    await page.screenshot({ path: OUTPUT_PATH, fullPage: false });
    console.log(`Saved screenshot to ${OUTPUT_PATH}`);
  } finally {
    await browser.close();
  }
}

/** Fills + submits the password screen if one is showing; no-op otherwise. */
async function login(page) {
  // `isVisible()` checks the DOM once and does not actually wait despite
  // accepting a `timeout` option, so use `waitFor` (a real actionability
  // wait) wherever "is this here yet" matters.
  const passwordInput = page.locator('input[type="password"]');
  const sawPasswordInput = await passwordInput
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!sawPasswordInput) return;

  await passwordInput.fill(PASSWORD);
  await page.locator('button[type="submit"]').click();

  // Login error means setup is done and the password is something else.
  const loginFailed = await page
    .getByText(/incorrect password|could not create password/i)
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (loginFailed) {
    throw new Error(
      `Login failed with password "${PASSWORD}". Set SHELFIE_PASSWORD to match ` +
        "the owner password, or run scripts/seed.mjs first to claim it.",
    );
  }
}

// Library grid items are `<button type="button">` cover tiles inside the
// route content div; the header's nav buttons aren't in a `.grid`, so this
// stays unambiguous without needing a landmark wrapper (the app renders none).
function libraryItem(page) {
  return page.locator(".flex > button").first();
}

/**
 * Waits for the library view to reach a stable state: either a cover tile or
 * the empty state means it mounted and finished its first load. Because a
 * cold profile can show the empty state for a beat before items sync in, we
 * wait out a short grace for the app to repopulate before accepting "empty".
 */
async function waitForLibraryToSettle(page) {
  await libraryItem(page)
    .or(page.getByText(EMPTY_STATE_TEXT))
    .first()
    .waitFor({ timeout: 15_000 });
  if (await libraryItem(page).isVisible().catch(() => false)) return;
  // Empty state is up; give the app's self-heal a beat to swap in synced items.
  await libraryItem(page)
    .waitFor({ timeout: SELF_HEAL_GRACE_MS })
    .catch(() => {});
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  console.error(
    `\nIs the client running? Try \`pnpm dev\` first (expected at ${CLIENT_URL}).`,
  );
  process.exitCode = 1;
});
