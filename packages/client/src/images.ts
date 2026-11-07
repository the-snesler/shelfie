import type { CoverShape, CoverSize } from "@shelfie/shared";

export type GameImageSize = "t_cover_big" | "t_screenshot_med" | "t_1080p";

/** Points at the server image-cache proxy (packages/server/src/images/routes.ts),
 *  which lazily downloads + serves IGDB images with a long cache timeout. */
export function gameImageUrl(size: GameImageSize, imageId: string): string {
  return `/api/images/${size}/${imageId}`;
}

const IGDB_COVER_URL_RE = /^\/api\/images\/t_cover_big\/([a-z0-9]+)$/i;

/**
 * Platform-fitted SteamGridDB cover (server route in images/routes.ts), which
 * redirects to the IGDB cover when there's no fitted art. Returns the IGDB
 * cover unchanged when the platform has no art shape or the id is unknown.
 */
export function gameCoverUrl(
  igdbCoverUrl: string | null,
  igdbId: number | null | undefined,
  shape: CoverShape | null,
  size: CoverSize,
): string | null {
  if (!shape || !igdbId) return igdbCoverUrl;
  const fallback = igdbCoverUrl
    ? IGDB_COVER_URL_RE.exec(igdbCoverUrl)?.[1]
    : undefined;
  const query = fallback ? `?fallback=${fallback}` : "";
  return `/api/images/covers/${size}/${shape}/${igdbId}${query}`;
}

export type TmdbImageSize = "w300" | "w342" | "w500" | "w1280";

/** Composes a full TMDB CDN URL from a bare path the server stores (e.g.
 *  "/gDzOcq0.jpg") — unlike IGDB images, TMDB CDN is loaded directly, no
 *  server-side proxy. `path` is nullable at call sites; callers guard. */
export function tmdbImageUrl(path: string, size: TmdbImageSize): string {
  return `https://image.tmdb.org/t/p/${size}${path}`;
}
