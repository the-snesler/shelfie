import templates from "./platforms.json";
import type { PlatformRelease, Storefront } from "@shelfie/shared";
import { STOREFRONT_PLATFORMS, storefrontCaseKey } from "./storefronts";

export interface PlatformTemplate {
  overlay?: string;
  aspectRatio: number; // case width / height
  heightMm: number; // physical case height, drives relative sizing
  caseColor: string; // hex, exposed as --case-color
  paddingTop?: number; // optional, in px. for platforms with "strip across the top" overlays, so the logos don't get cut off by the top of the box.
  paddingLeft?: number; // optional, in px. same idea for overlays with a strip/bezel down the left edge (e.g. DS/3DS).
  paddingRight?: number; // optional, in px. same idea for overlays with a strip/bezel down the right edge.
  material?: "cardboard"; // optional. cardboard boxes drop the plastic case's translucent edges.
}

/** Case templates, keyed by IGDB platform name or by a synthetic case key
 *  such as "PC big box" (see {@link selectCaseKey}). */
export const platformTemplates: Record<string, PlatformTemplate> =
  templates as Record<string, PlatformTemplate>;

/** Fallback dims for untemplated platforms (~IGDB cover ratio). */
export const DEFAULT_TEMPLATE = { aspectRatio: 0.71, heightMm: 172 } as const;

/** px per mm of case height, per surface. */
export const LIBRARY_COVER_SCALE = 1.0;
export const DETAIL_COVER_SCALE = 1.5;
export const SEARCH_COVER_SCALE = 0.37;

/** Computes the rendered width for a game cover at a given scale. */
export function gameCoverWidth(caseKey: string | null, scale: number): number {
  const template = caseKey ? platformTemplates[caseKey] : undefined;
  const aspectRatio = template?.aspectRatio ?? DEFAULT_TEMPLATE.aspectRatio;
  const heightMm = template?.heightMm ?? DEFAULT_TEMPLATE.heightMm;
  return heightMm * scale * aspectRatio + 4; // +4px for the case padding
}

/** Shared `view-transition-name` for a game's cover, keyed by its route
 *  slug — the one identifier every surface (library card, search result,
 *  detail route param) already has synchronously, so the destination page
 *  can tag its cover box on first paint, before any async fetch resolves
 *  (the browser only pairs old/new elements present when it snapshots). */
export function gameCoverTransitionName(slug: string): string {
  return `game-cover-${slug}`;
}

export const PC_PLATFORM = "PC (Microsoft Windows)";

/** Platforms whose retail packaging changed with the era. */
const ERA_PLATFORMS = new Set([PC_PLATFORM, "DOS"]);

/** Mac/Linux releases are usually ports of a Windows or console game, so
 *  they only become a title's default case when nothing else is templated. */
const PORT_PLATFORMS = new Set(["Mac", "Linux"]);

/**
 * Picks the platform whose overlay to render.
 * - User has recorded platforms -> their first choice, verbatim.
 * - Otherwise -> earliest-released templated platform, skipping Mac/Linux
 *   ports; else an earliest-released templated port; else the
 *   earliest-released platform overall; else the first listed platform.
 */
export function selectPlatform(
  userPlatforms: string[],
  metaPlatforms: string[],
  platformReleaseDates: PlatformRelease[],
): string | null {
  if (userPlatforms.length > 0) return userPlatforms[0];
  const releaseOrdered = platformReleaseDates.map((r) => r.platform);
  const ordered = [
    ...releaseOrdered,
    ...metaPlatforms.filter((p) => !releaseOrdered.includes(p)),
  ];
  const templated = ordered.filter(
    (p) => p in platformTemplates || ERA_PLATFORMS.has(p),
  );
  return (
    templated.find((p) => !PORT_PLATFORMS.has(p)) ??
    templated[0] ??
    ordered[0] ??
    null
  );
}

/** PC retail formats by release year, oldest first: the first entry whose
 *  `before` year is later than the release wins; anything newer gets the
 *  modern PC strip. The cutoffs are approximate (formats overlapped, and
 *  differed by region). */
export const PC_ERA_CASES: readonly { before: number; caseKey: string }[] = [
  { before: 2002, caseKey: "PC big box" },
  { before: 2006, caseKey: "PC jewel case" },
  { before: 2015, caseKey: "PC DVD" },
];

/** Earliest dated release on `platform`, else on any platform (epoch s). */
function releaseDateFor(
  platform: string,
  platformReleaseDates: PlatformRelease[],
): number | null {
  const own = platformReleaseDates.find((r) => r.platform === platform);
  if (own) return own.date;
  if (platformReleaseDates.length === 0) return null;
  return Math.min(...platformReleaseDates.map((r) => r.date));
}

/**
 * Maps the selected platform to the case template to render. Most platforms
 * are their own case; PC and DOS pick a retail format from the year the
 * game came out on that platform (undated DOS games get a big box, undated
 * PC games the modern strip).
 */
export function selectCaseKey(
  platform: string | null,
  platformReleaseDates: PlatformRelease[],
): string | null {
  if (!platform || !ERA_PLATFORMS.has(platform)) return platform;
  const date = releaseDateFor(platform, platformReleaseDates);
  if (date === null) return platform === "DOS" ? "PC big box" : PC_PLATFORM;
  const year = new Date(date * 1000).getUTCFullYear();
  return PC_ERA_CASES.find((era) => year < era.before)?.caseKey ?? PC_PLATFORM;
}

/**
 * The case template key every game cover surface renders:
 * {@link selectPlatform}, then the owner's storefront strip when they own
 * the game on a PC-family platform, else {@link selectCaseKey}. The
 * storefront only counts alongside the owner's own platforms, never for a
 * platform picked from metadata.
 */
export function selectGameCase(
  userPlatforms: string[],
  metaPlatforms: string[],
  platformReleaseDates: PlatformRelease[],
  storefront: Storefront | null = null,
): string | null {
  const platform = selectPlatform(
    userPlatforms,
    metaPlatforms,
    platformReleaseDates,
  );
  if (
    storefront &&
    userPlatforms.length > 0 &&
    platform &&
    STOREFRONT_PLATFORMS.has(platform) &&
    storefrontCaseKey(storefront) in platformTemplates
  ) {
    return storefrontCaseKey(storefront);
  }
  return selectCaseKey(platform, platformReleaseDates);
}
