import type { ItemStatus, MediaType, MetaStatus } from "@shelfie/shared";
import { ITEM_STATUSES } from "@shelfie/shared";
import type { FunctionComponent, SVGProps } from "react";
import IconHeart from "~icons/tabler/heart";
import IconStack from "~icons/tabler/stack-2";
import IconPlay from "~icons/tabler/player-play";
import IconPause from "~icons/tabler/player-pause";
import IconCircleCheck from "~icons/tabler/circle-check";
import IconCircleDashedX from "~icons/tabler/circle-dashed-x";
import IconRosette from "~icons/tabler/rosette-discount-check";

type IconComponent = FunctionComponent<SVGProps<SVGSVGElement>>;

/** Per-media UI wording for every canonical status, even ones a given media
 *  type never exposes (see {@link STATUSES_BY_MEDIA}) — keeping the map
 *  total avoids partial-record lookups everywhere a label is read. */
export const STATUS_LABELS: Record<MediaType, Record<ItemStatus, string>> = {
  game: {
    wishlisted: "Wishlisted",
    backlogged: "Backlogged",
    active: "Playing",
    paused: "Paused",
    dropped: "Played",
    finished: "Beaten",
    completed: "Completed",
  },
  movie: {
    wishlisted: "Wishlisted",
    backlogged: "Watchlist",
    active: "Watching",
    paused: "Paused",
    dropped: "Abandoned",
    finished: "Watched",
    completed: "Completed",
  },
  tv: {
    wishlisted: "Wishlisted",
    backlogged: "Watchlist",
    active: "Watching",
    paused: "Paused",
    dropped: "Dropped",
    finished: "Watched",
    completed: "Completed",
  },
  book: {
    wishlisted: "Wishlisted",
    backlogged: "To Read",
    active: "Reading",
    paused: "Paused",
    dropped: "Abandoned",
    finished: "Read",
    completed: "Completed",
  },
};

/** Media-neutral wording for when several media types share one view (e.g.
 *  an "All media" list), where per-media labels like Played/Abandoned or
 *  Playing/Reading would each be wrong for some of the items. */
export const NEUTRAL_STATUS_LABELS: Record<ItemStatus, string> = {
  wishlisted: "Wishlist",
  backlogged: "Backlog",
  active: "Active",
  paused: "Paused",
  dropped: "Dropped",
  finished: "Finished",
  completed: "Completed",
};

/** Status wording for one media type, or the neutral wording for null. */
export function statusLabel(
  status: ItemStatus,
  mediaType: MediaType | null,
): string {
  return mediaType
    ? STATUS_LABELS[mediaType][status]
    : NEUTRAL_STATUS_LABELS[status];
}

/** Excitement levels (`LibraryItem.excitement`), lowest first — the planned
 *  counterpart of a rating, so the wording is media-neutral. */
export const EXCITEMENT_LEVELS = [1, 2, 3, 4] as const;
export type ExcitementLevel = (typeof EXCITEMENT_LEVELS)[number];

export const EXCITEMENT_LABELS: Record<ExcitementLevel, string> = {
  4: "Can't wait",
  3: "Very interested",
  2: "Mildly interested",
  1: "No urgency",
};

/** Label for a stored excitement value; null when unset or out of range. */
export function excitementLabel(value: number | null): string | null {
  return value == null
    ? null
    : (EXCITEMENT_LABELS[value as ExcitementLevel] ?? null);
}

export const META_STATUS_LABELS: Record<MetaStatus, string> = {
  planned: "Planned",
  "in-progress": "In Progress",
  finished: "Finished",
};

/** Which statuses each media type's status list/picker exposes, in display
 *  order. Games expose the full canonical set; other media trim statuses
 *  that don't make sense for them (e.g. movies skip `paused`/`completed`). */
export const STATUSES_BY_MEDIA: Record<MediaType, readonly ItemStatus[]> = {
  game: ITEM_STATUSES,
  movie: ["backlogged", "active", "dropped", "finished"],
  tv: ["backlogged", "active", "paused", "dropped", "finished"],
  book: ["backlogged", "active", "paused", "dropped", "finished"],
};

export const STATUS_ICONS: Record<ItemStatus, IconComponent> = {
  wishlisted: IconHeart,
  backlogged: IconStack,
  active: IconPlay,
  paused: IconPause,
  dropped: IconCircleDashedX,
  finished: IconCircleCheck,
  completed: IconRosette,
};

/** Statuses whose selection prompts for a completion date. Kept explicit
 *  (not `STATUS_META_GROUP[s] === "finished"`) because `dropped` shares the
 *  finished bucket with `finished`/`completed` but must still prompt the
 *  same way `played` did pre-remap — this table is the one place that
 *  intent lives, independent of the coarse meta-status grouping. */
export const COMPLETION_STATUSES: Record<ItemStatus, boolean> = {
  wishlisted: false,
  backlogged: false,
  active: false,
  paused: false,
  dropped: false,
  finished: true,
  completed: true,
};
