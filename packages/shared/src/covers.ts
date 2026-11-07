/**
 * Shape buckets for platform-fitted game cover art (SteamGridDB "grids").
 * SteamGridDB only publishes a few fixed sizes, so each platform case's art
 * window maps to the nearest bucket and the image is cropped to fit.
 *
 * - `square` — 512×512 / 1024×1024 (PS1–PS5, Xbox, DS/3DS: banner-topped cases)
 * - `iso`    — 342×482 / 660×930, ≈1:√2 (DVD-style cases: GameCube, Wii)
 * - `tall`   — 600×900, 2:3 (Switch, PSP-style narrow cases)
 */
export const COVER_SHAPES = ["square", "iso", "tall"] as const;
export type CoverShape = (typeof COVER_SHAPES)[number];

/** Width / height of each bucket's art. */
export const COVER_SHAPE_ASPECT: Record<CoverShape, number> = {
  square: 1,
  iso: 342 / 482,
  tall: 600 / 900,
};

/** `full` is the original upload (often a 1MB+ PNG); `thumb` is SteamGridDB's
 *  400px JPEG rendition, plenty for grid- and search-sized covers. */
export const COVER_SIZES = ["thumb", "full"] as const;
export type CoverSize = (typeof COVER_SIZES)[number];

/** Nearest bucket for an art window of the given width / height ratio. */
export function nearestCoverShape(aspect: number): CoverShape {
  let best: CoverShape = "iso";
  let bestDistance = Infinity;
  for (const shape of COVER_SHAPES) {
    const distance = Math.abs(Math.log(aspect / COVER_SHAPE_ASPECT[shape]));
    if (distance < bestDistance) {
      best = shape;
      bestDistance = distance;
    }
  }
  return best;
}
