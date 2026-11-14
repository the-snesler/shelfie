/**
 * Cover keys name a cover independently of the size it is displayed at, so
 * a card, its detail page and a search row that show the same art share one
 * `cover_hashes` row. `coverFetchUrl` turns a key back into the smallest
 * upstream variant worth hashing (ThumbHash only reads ≤100px anyway).
 */

const IGDB_IMAGE_ID_RE = /^[a-z0-9]+$/i;
const IGDB_PROXY_PATH_RE = /^\/api\/images\/[a-z0-9_]+\/([a-z0-9]+)$/i;
const TMDB_PATH_RE = /^\/[\w-]+\.(?:jpe?g|png|webp)$/i;
/** Amazon's image service size segment, e.g. `._SY75_` or `._SX98_`. */
const AMAZON_SIZE_RE = /\._S[XY]\d+_(?=\.[a-z]+$)/i;
/** Goodreads covers live on Amazon's image service or Goodreads' own CDN. */
const GOODREADS_HOSTS = [
  "media-amazon.com",
  "ssl-images-amazon.com",
  "gr-assets.com",
];

export function igdbCoverKey(imageId: string | null): string | null {
  return imageId && IGDB_IMAGE_ID_RE.test(imageId) ? `igdb:${imageId}` : null;
}

/** Game search rows only carry the proxied URL (`/api/images/<size>/<id>`). */
export function igdbCoverKeyFromProxyUrl(url: string | null): string | null {
  const match = url ? IGDB_PROXY_PATH_RE.exec(url) : null;
  return match ? igdbCoverKey(match[1]!) : null;
}

export function tmdbCoverKey(path: string | null): string | null {
  return path && TMDB_PATH_RE.test(path) ? `tmdb:${path}` : null;
}

export function goodreadsCoverKey(url: string | null): string | null {
  const parsed = goodreadsUrl(url);
  if (!parsed) return null;
  parsed.pathname = parsed.pathname.replace(AMAZON_SIZE_RE, "");
  return `goodreads:${parsed.href}`;
}

/** Only https URLs on the known Goodreads cover hosts are ever fetched. */
function goodreadsUrl(url: string | null): URL | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname;
  return GOODREADS_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  )
    ? parsed
    : null;
}

/** The small upstream image to hash for a key, or null for a malformed key. */
export function coverFetchUrl(key: string): string | null {
  const split = key.indexOf(":");
  const source = key.slice(0, split);
  const value = key.slice(split + 1);
  switch (source) {
    case "igdb":
      return IGDB_IMAGE_ID_RE.test(value)
        ? `https://images.igdb.com/igdb/image/upload/t_cover_small/${value}.jpg`
        : null;
    case "tmdb":
      return TMDB_PATH_RE.test(value)
        ? `https://image.tmdb.org/t/p/w92${value}`
        : null;
    case "goodreads": {
      const parsed = goodreadsUrl(value);
      if (!parsed) return null;
      // Full-size Goodreads covers run to hundreds of KB; the image service
      // resizes on request. Goodreads' own static assets don't support it.
      if (parsed.pathname.startsWith("/images/")) {
        parsed.pathname = parsed.pathname.replace(/(?=\.[a-z]+$)/i, "._SY100_");
      }
      return parsed.href;
    }
    default:
      return null;
  }
}
