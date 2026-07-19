import templates from "./platforms.json";
import type { PlatformRelease } from "@shelfie/shared";

export interface PlatformTemplate {
  overlay: string;
  aspectRatio: number; // case width / height
  heightMm: number; // physical case height, drives relative sizing
  caseColor: string; // hex, exposed as --case-color
  paddingTop?: number; // optional, in px. for platforms with "strip across the top" overlays, so the logos don't get cut off by the top of the box.
}

export const platformTemplates: Record<string, PlatformTemplate> = templates;

/** Fallback dims for untemplated platforms (~IGDB cover ratio). */
export const DEFAULT_TEMPLATE = { aspectRatio: 0.71, heightMm: 172 } as const;

/** px per mm of case height, per surface. */
export const LIBRARY_COVER_SCALE = 1.0;
export const DETAIL_COVER_SCALE = 1.5;
export const SEARCH_COVER_SCALE = 0.37;

/** Computes the rendered width for a game cover at a given scale. */
export function gameCoverWidth(
  platform: string | null,
  scale: number,
): number {
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
