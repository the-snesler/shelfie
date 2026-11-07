import type { Kysely } from "kysely";
import { booksMetadataCollection } from "../books/routes.js";
import { db as defaultDb } from "../db/index.js";
import type { Database } from "../db/types.js";
import { gamesMetadataCollection } from "../games/routes.js";
import { moviesMetadataCollection } from "../movies/routes.js";
import { tvMetadataCollection } from "../tv/routes.js";
import { runReleaseRefreshCycle, watchMedium } from "./releaseRefresh.js";

const PASS_INTERVAL_MS = 60 * 60 * 1000;
/** Let boot-time traffic (the first library refresh) go first. */
const FIRST_PASS_DELAY_MS = 60 * 1000;

const WATCHED_MEDIA = [
  watchMedium("game", gamesMetadataCollection),
  watchMedium("movie", moviesMetadataCollection),
  watchMedium("tv", tvMetadataCollection),
  watchMedium("book", booksMetadataCollection),
];

/**
 * Hourly background refresh of release dates for planned titles, so the
 * Unreleased shelf, the iCal feed, and release reminders see moved dates
 * without the app being open. Single-process, like the other workers.
 */
export function startReleaseRefreshWorker(
  database: Kysely<Database> = defaultDb,
): () => Promise<void> {
  let stopped = false;
  let activePass: Promise<void> | null = null;

  const startPass = () => {
    if (activePass || stopped) return;
    activePass = runReleaseRefreshCycle(
      database,
      WATCHED_MEDIA,
      Date.now(),
      () => stopped,
    )
      .then((failed) => {
        if (failed.length > 0) {
          console.error(
            `Shelfie release refresh could not reach: ${failed.join(", ")}`,
          );
        }
      })
      .catch(() => {
        console.error("Shelfie release refresh could not complete its pass");
      })
      .finally(() => {
        activePass = null;
      });
  };

  const first = setTimeout(startPass, FIRST_PASS_DELAY_MS);
  first.unref();
  const timer = setInterval(startPass, PASS_INTERVAL_MS);
  timer.unref();

  return async () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(timer);
    await activePass;
  };
}
