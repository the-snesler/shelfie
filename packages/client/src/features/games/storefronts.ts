import { STOREFRONTS, type Storefront } from "@shelfie/shared";

/** Display names for each PC storefront, in picker order. */
export const STOREFRONT_LABELS: Record<Storefront, string> = {
  steam: "Steam",
  epic: "Epic Games Store",
  gog: "GOG",
  ea: "EA app",
  ubisoft: "Ubisoft Connect",
  battlenet: "Battle.net",
  microsoft: "Microsoft Store",
  itch: "itch.io",
  amazon: "Amazon Games",
  riot: "Riot Games",
};

export { STOREFRONTS };

/** Platforms a digital storefront applies to: the store strip replaces the
 *  platform's own case only when one of these is the cover's platform. */
export const STOREFRONT_PLATFORMS: ReadonlySet<string> = new Set([
  "PC (Microsoft Windows)",
  "Mac",
  "Linux",
  "DOS",
]);

/** True when any of the given platforms can carry a storefront. */
export function hasStorefrontPlatform(platforms: readonly string[]): boolean {
  return platforms.some((p) => STOREFRONT_PLATFORMS.has(p));
}

/** Template key of a storefront's case strip, e.g. "store:steam". */
export function storefrontCaseKey(storefront: Storefront): string {
  return `store:${storefront}`;
}
