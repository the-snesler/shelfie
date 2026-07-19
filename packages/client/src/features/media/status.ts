import type { ItemStatus, MediaType } from "@shelfie/shared";
import { ITEM_STATUSES } from "@shelfie/shared";
import type { FunctionComponent, SVGProps } from "react";
import IconHeart from "~icons/tabler/heart";
import IconStack from "~icons/tabler/stack-2";
import IconGamepad from "~icons/tabler/device-gamepad-2";
import IconPause from "~icons/tabler/player-pause";
import IconCircleCheck from "~icons/tabler/circle-check";
import IconTrophy from "~icons/tabler/trophy";
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

/** Which statuses each media type's status list/picker exposes, in display
 *  order. Games expose the full canonical set; other media trim statuses
 *  that don't make sense for them (e.g. movies skip `paused`/`completed`). */
export const STATUSES_BY_MEDIA: Record<MediaType, readonly ItemStatus[]> = {
  game: ITEM_STATUSES,
  movie: ["wishlisted", "backlogged", "active", "dropped", "finished"],
  tv: ["wishlisted", "backlogged", "active", "paused", "dropped", "finished"],
  book: ["wishlisted", "backlogged", "active", "paused", "dropped", "finished"],
};

export const STATUS_ICONS: Record<ItemStatus, IconComponent> = {
  wishlisted: IconHeart,
  backlogged: IconStack,
  active: IconGamepad,
  paused: IconPause,
  dropped: IconCircleCheck,
  finished: IconTrophy,
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
  dropped: true,
  finished: true,
  completed: true,
};
