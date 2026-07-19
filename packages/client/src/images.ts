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
