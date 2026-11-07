import templates from "./platforms.json";
import {
  nearestCoverShape,
  type CoverShape,
  type PlatformRelease,
} from "@shelfie/shared";

export interface PlatformTemplate {
  /** Case-front PNG drawn over the art; optional so a platform can get
   *  real case geometry (and a fitted art shape) before its overlay exists. */
  overlay?: string;
  aspectRatio: number; // case width / height
  heightMm: number; // physical case height, drives relative sizing
  caseColor: string; // hex, exposed as --case-color
  paddingTop?: number; // optional, in mm (scaled like heightMm). Height of the case's top banner strip, kept clear of art so overlay logos don't cover it.
}

export const platformTemplates: Record<string, PlatformTemplate> = templates;

/** Fallback dims for untemplated platforms (~IGDB cover ratio). */
export const DEFAULT_TEMPLATE = { aspectRatio: 0.71, heightMm: 172 } as const;

/** px per mm of case height, per surface. */
export const LIBRARY_COVER_SCALE = 1.0;
export const DETAIL_COVER_SCALE = 1.5;
export const SEARCH_COVER_SCALE = 0.37;

/**
 * SteamGridDB art bucket for a platform's art window — the case front below
 * its banner (`paddingTop`). Null for untemplated platforms, which keep the
 * IGDB cover at the default case ratio.
 */
export function platformCoverShape(platform: string | null): CoverShape | null {
  const template = platform ? platformTemplates[platform] : undefined;
  if (!template) return null;
  const artHeightMm = template.heightMm - (template.paddingTop ?? 0);
  return nearestCoverShape(
    (template.aspectRatio * template.heightMm) / artHeightMm,
  );
}

/** Computes the rendered width for a game cover at a given scale. */
export function gameCoverWidth(platform: string | null, scale: number): number {
  const template = platform ? platformTemplates[platform] : undefined;
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

/**
 * Picks the platform whose overlay to render.
 * - User has recorded platforms -> their first choice, verbatim.
 * - Otherwise -> earliest-released platform that has a template; else the
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
  return ordered.find((p) => p in platformTemplates) ?? ordered[0] ?? null;
}
