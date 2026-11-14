import type { Kysely } from "kysely";
import sharp from "sharp";
import { rgbaToThumbHash } from "thumbhash";
import { db as defaultDb } from "../db/index.js";
import type { Database } from "../db/types.js";
import { coverFetchUrl } from "./coverKeys.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A cover that failed to fetch or decode is retried no sooner than this. */
export const COVER_HASH_RETRY_MS = DAY_MS;
const FETCH_TIMEOUT_MS = 15_000;
/** Small variants are a few KB; anything this large is not a cover. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** ThumbHash encodes images of at most 100×100. */
export async function thumbHashFromImage(bytes: Uint8Array): Promise<string> {
  const { data, info } = await sharp(bytes)
    .resize(100, 100, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString(
    "base64",
  );
}

/**
 * Known hashes for `keys`, plus the keys still worth hashing: never tried,
 * or failed more than `COVER_HASH_RETRY_MS` ago.
 */
export async function resolveCoverHashes(
  database: Kysely<Database>,
  keys: readonly string[],
  now = Date.now(),
): Promise<{ hashes: Map<string, string>; missing: string[] }> {
  const unique = [...new Set(keys)];
  const hashes = new Map<string, string>();
  if (unique.length === 0) return { hashes, missing: [] };
  const rows = await database
    .selectFrom("cover_hashes")
    .selectAll()
    .where("cover_key", "in", unique)
    .execute();
  const settled = new Set<string>();
  for (const row of rows) {
    if (row.hash !== null) hashes.set(row.cover_key, row.hash);
    if (row.hash !== null || row.checked_at > now - COVER_HASH_RETRY_MS) {
      settled.add(row.cover_key);
    }
  }
  return { hashes, missing: unique.filter((key) => !settled.has(key)) };
}

export type FetchImage = (
  url: string,
  signal: AbortSignal,
) => Promise<Uint8Array>;

async function fetchImage(
  url: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const res = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
  });
  if (!res.ok) throw new Error(`cover fetch failed (${res.status})`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) {
    throw new Error("cover too large");
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("cover too large");
  return bytes;
}

export interface CoverHashQueueOptions {
  /** Covers come from image CDNs, not the throttled catalog APIs. */
  concurrency?: number;
  /** Drops further keys while this many wait; later requests re-enqueue them. */
  maxPending?: number;
  fetchImage?: FetchImage;
  now?: () => number;
}

/**
 * Hashes covers in the background so no response waits on an image fetch.
 * Results land in `cover_hashes`; clients receive them with their next card
 * fetch. Dedupes keys that are queued or in flight.
 */
export class CoverHashQueue {
  private readonly pending = new Set<string>();
  private readonly inflight = new Set<string>();
  private readonly abort = new AbortController();
  private readonly concurrency: number;
  private readonly maxPending: number;
  private readonly fetchImage: FetchImage;
  private readonly now: () => number;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly database: Kysely<Database>,
    options: CoverHashQueueOptions = {},
  ) {
    this.concurrency = options.concurrency ?? 4;
    this.maxPending = options.maxPending ?? 1000;
    this.fetchImage = options.fetchImage ?? fetchImage;
    this.now = options.now ?? Date.now;
  }

  enqueue(keys: Iterable<string>): void {
    if (this.abort.signal.aborted) return;
    for (const key of keys) {
      if (this.pending.size >= this.maxPending) break;
      if (!this.inflight.has(key)) this.pending.add(key);
    }
    this.pump();
  }

  /** Resolves once nothing is queued or in flight. */
  idle(): Promise<void> {
    if (this.pending.size === 0 && this.inflight.size === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Drops queued keys, aborts in-flight fetches, and waits for them to settle. */
  async stop(): Promise<void> {
    this.pending.clear();
    this.abort.abort();
    await this.idle();
  }

  private pump(): void {
    while (
      !this.abort.signal.aborted &&
      this.inflight.size < this.concurrency &&
      this.pending.size > 0
    ) {
      const key = this.pending.values().next().value!;
      this.pending.delete(key);
      this.inflight.add(key);
      void this.process(key).finally(() => {
        this.inflight.delete(key);
        this.pump();
        if (this.pending.size === 0 && this.inflight.size === 0) {
          const waiters = this.idleWaiters;
          this.idleWaiters = [];
          for (const resolve of waiters) resolve();
        }
      });
    }
  }

  private async process(key: string): Promise<void> {
    let hash: string | null = null;
    try {
      const url = coverFetchUrl(key);
      if (!url) throw new Error("unrecognised cover key");
      hash = await thumbHashFromImage(
        await this.fetchImage(url, this.abort.signal),
      );
    } catch (error) {
      // Shutting down is not the cover's fault; leave it for next time.
      if (this.abort.signal.aborted) return;
      console.warn(`Could not hash cover ${key}:`, (error as Error).message);
    }
    try {
      await this.database
        .insertInto("cover_hashes")
        .values({ cover_key: key, hash, checked_at: this.now() })
        .onConflict((oc) =>
          oc.column("cover_key").doUpdateSet({ hash, checked_at: this.now() }),
        )
        .execute();
    } catch (error) {
      console.warn(`Could not store cover hash ${key}:`, error);
    }
  }
}

let active: CoverHashQueue | null = null;

/**
 * Queues covers for hashing. A no-op until `startCoverHashWorker` runs (only
 * `index.ts` starts it), so apps built in tests never fetch images.
 */
export function enqueueCoverHashes(keys: Iterable<string>): void {
  active?.enqueue(keys);
}

export function startCoverHashWorker(
  database: Kysely<Database> = defaultDb,
  options?: CoverHashQueueOptions,
): () => Promise<void> {
  const queue = new CoverHashQueue(database, options);
  active = queue;
  return async () => {
    if (active === queue) active = null;
    await queue.stop();
  };
}
