import type React from "react";
import { thumbHashToDataURL } from "thumbhash";

export type GameImageSize = "t_cover_big" | "t_screenshot_med" | "t_1080p";

/** Points at the server image-cache proxy (packages/server/src/images/routes.ts),
 *  which lazily downloads + serves IGDB images with a long cache timeout. */
export function gameImageUrl(size: GameImageSize, imageId: string): string {
  return `/api/images/${size}/${imageId}`;
}

export type TmdbImageSize = "w300" | "w342" | "w500" | "w1280";

/** Composes a full TMDB CDN URL from a bare path the server stores (e.g.
 *  "/gDzOcq0.jpg") — unlike IGDB images, TMDB CDN is loaded directly, no
 *  server-side proxy. `path` is nullable at call sites; callers guard. */
export function tmdbImageUrl(path: string, size: TmdbImageSize): string {
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

/** Decoded placeholders, keyed by hash. Decoding costs ~0.5 ms, and a
 *  virtualized grid remounts the same covers while scrolling. */
const placeholders = new Map<string, string>();
const PLACEHOLDER_CACHE_LIMIT = 500;

/** The PNG data URL for a card's base64 ThumbHash (`coverHash`), painted
 *  behind a cover until the real image loads. Undefined without a hash, or
 *  if the hash cannot be decoded. */
export function coverPlaceholderUrl(
  hash: string | null | undefined,
): string | undefined {
  if (!hash) return undefined;
  const cached = placeholders.get(hash);
  if (cached) return cached;
  let url: string;
  try {
    const bytes = Uint8Array.from(atob(hash), (char) => char.charCodeAt(0));
    url = thumbHashToDataURL(bytes);
  } catch {
    return undefined;
  }
  if (placeholders.size >= PLACEHOLDER_CACHE_LIMIT) {
    placeholders.delete(placeholders.keys().next().value!);
  }
  placeholders.set(hash, url);
  return url;
}

/** Inline style that paints a cover's placeholder behind an `<img>` (inside
 *  its padding, for case-art templates) until the image covers it. */
export function coverPlaceholderStyle(
  hash: string | null | undefined,
): React.CSSProperties | undefined {
  const url = coverPlaceholderUrl(hash);
  if (!url) return undefined;
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundOrigin: "content-box",
    backgroundClip: "content-box",
  };
}
