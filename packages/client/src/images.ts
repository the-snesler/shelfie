export type GameImageSize = "t_cover_big" | "t_screenshot_med" | "t_1080p";

/** Points at the server image-cache proxy (packages/server/src/images/routes.ts),
 *  which lazily downloads + serves IGDB images with a long cache timeout. */
export function gameImageUrl(size: GameImageSize, imageId: string): string {
  return `/api/images/${size}/${imageId}`;
}
