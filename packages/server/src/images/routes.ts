import {
  COVER_SHAPES,
  COVER_SIZES,
  type CoverShape,
  type CoverSize,
} from "@shelfie/shared";
import type { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db as defaultDb } from "../db/index.js";
import {
  createCoverResolver,
  type CoverResolver,
} from "../steamgriddb/covers.js";

/** IGDB size tokens the client renders. Anything else → 400, keeping this a
 *  fixed-shape proxy rather than an open one. */
const ALLOWED_SIZES = new Set(["t_cover_big", "t_screenshot_med", "t_1080p"]);

/** IGDB image ids are alphanumeric, e.g. "co1r76". */
const IMAGE_ID_RE = /^[a-z0-9]+$/i;

/** Mirrors db/index.ts DATA_DIR resolution (default "./data"). */
const IMAGES_DIR = join(process.env.DATA_DIR ?? "./data", "images");

const IGDB_IMAGE_BASE = "https://images.igdb.com/igdb/image/upload";

/** Content-addressed ids never change → cache "forever". */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

/** SteamGridDB's CDN layout; anything else from the API is ignored rather
 *  than proxied, keeping the cover route a fixed-shape proxy too. */
const SGDB_CDN_RE =
  /^https:\/\/cdn2\.steamgriddb\.com\/(grid|thumb)\/([0-9a-f]{16,64})\.(png|jpe?g|webp)$/;

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** The game→art mapping can change after the cache TTL, so cover responses
 *  are cached for a day rather than "forever" like content-addressed ids. */
const COVER_CACHE_CONTROL =
  "public, max-age=86400, stale-while-revalidate=604800";

export function registerImageRoutes(
  app: Hono,
  resolveCover: CoverResolver = createCoverResolver(defaultDb),
): void {
  /**
   * Platform-fitted cover art from SteamGridDB for a cached IGDB game. Falls
   * back to a redirect to the IGDB cover named by `?fallback=<imageId>` (or a
   * 404 without one) when there is no key, no match, or an upstream error.
   */
  app.get("/api/images/covers/:size/:shape/:igdbId", async (c) => {
    const size = c.req.param("size") as CoverSize;
    const shape = c.req.param("shape") as CoverShape;
    const igdbId = Number(c.req.param("igdbId"));
    const fallback = c.req.query("fallback");
    if (
      !COVER_SIZES.includes(size) ||
      !COVER_SHAPES.includes(shape) ||
      !Number.isSafeInteger(igdbId) ||
      igdbId <= 0 ||
      (fallback !== undefined && !IMAGE_ID_RE.test(fallback))
    ) {
      return c.json({ error: "invalid cover request" }, 400);
    }

    try {
      const grid = await resolveCover(igdbId, shape);
      const match = grid
        ? SGDB_CDN_RE.exec(size === "thumb" ? grid.thumb : grid.url)
        : null;
      if (match) {
        const [url, kind, hash, ext] = match;
        const dir = join(IMAGES_DIR, "sgdb", kind);
        const bytes = await readOrDownload(
          dir,
          join(dir, `${hash}.${ext}`),
          url,
        );
        if (bytes) {
          c.header("Content-Type", CONTENT_TYPES[ext]);
          c.header("Cache-Control", COVER_CACHE_CONTROL);
          return c.body(bytes);
        }
      }
    } catch (err) {
      console.warn(`SteamGridDB cover lookup failed for ${igdbId}:`, err);
    }
    // Never cache the fallback: a game not yet in the catalog (e.g. a search
    // result) or a transient upstream failure may resolve on the next request.
    c.header("Cache-Control", "no-store");
    if (!fallback) return c.json({ error: "no cover" }, 404);
    return c.redirect(`/api/images/t_cover_big/${fallback}`, 302);
  });

  app.get("/api/images/:size/:id", async (c) => {
    const size = c.req.param("size");
    const id = c.req.param("id");
    if (!ALLOWED_SIZES.has(size) || !IMAGE_ID_RE.test(id)) {
      return c.json({ error: "invalid image request" }, 400);
    }

    const dir = join(IMAGES_DIR, size);
    const diskPath = join(dir, `${id}.jpg`);

    // Cache hit.
    try {
      const bytes = await readFile(diskPath);
      c.header("Content-Type", "image/jpeg");
      c.header("Cache-Control", CACHE_CONTROL);
      return c.body(new Uint8Array(bytes));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    // Cache miss: fetch from IGDB's public image CDN (no auth, no throttle).
    let res: Response;
    try {
      res = await fetch(`${IGDB_IMAGE_BASE}/${size}/${id}.jpg`);
    } catch {
      return c.json({ error: "upstream fetch failed" }, 502);
    }
    if (res.status === 404) return c.json({ error: "not found" }, 404);
    if (!res.ok) return c.json({ error: "upstream error" }, 502);

    const bytes = new Uint8Array(await res.arrayBuffer());
    await persist(dir, diskPath, bytes);

    c.header("Content-Type", "image/jpeg");
    c.header("Cache-Control", CACHE_CONTROL);
    return c.body(bytes);
  });
}

/** Disk-cached download of a CDN image; null on a CDN error status, throws
 *  when the connection fails twice. */
async function readOrDownload(
  dir: string,
  diskPath: string,
  url: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return new Uint8Array(await readFile(diskPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  // One retry: the CDN occasionally resets connections mid-download.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      await persist(dir, diskPath, bytes);
      return bytes;
    } catch (err) {
      if (attempt >= 1) throw err;
    }
  }
}

/** Temp-write + atomic rename so concurrent readers never observe a partial file. */
async function persist(
  dir: string,
  diskPath: string,
  bytes: Uint8Array,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tmp = `${diskPath}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, diskPath);
  } catch {
    await unlink(tmp).catch(() => {});
  }
}
