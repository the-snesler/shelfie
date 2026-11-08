import type { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

export function registerImageRoutes(app: Hono): void {
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
