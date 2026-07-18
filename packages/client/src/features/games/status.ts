import type { ItemStatus } from "@shelfie/shared";
import type { FunctionComponent, SVGProps } from "react";
import IconHeart from "~icons/tabler/heart";
import IconStack from "~icons/tabler/stack-2";
import IconGamepad from "~icons/tabler/device-gamepad-2";
import IconPause from "~icons/tabler/player-pause";
import IconCircleCheck from "~icons/tabler/circle-check";
import IconTrophy from "~icons/tabler/trophy";
import IconRosette from "~icons/tabler/rosette-discount-check";

type IconComponent = FunctionComponent<SVGProps<SVGSVGElement>>;

export const STATUS_LABELS: Record<ItemStatus, string> = {
  wishlisted: "Wishlisted",
  backlogged: "Backlogged",
  playing: "Playing",
  paused: "Paused",
  played: "Played",
  beaten: "Beaten",
  completed: "Completed",
};

export const STATUS_ICONS: Record<ItemStatus, IconComponent> = {
  wishlisted: IconHeart,
  backlogged: IconStack,
  playing: IconGamepad,
  paused: IconPause,
  played: IconCircleCheck,
  beaten: IconTrophy,
  completed: IconRosette,
};

/** Statuses whose selection prompts for a completion date. Kept explicit
 *  (not `STATUS_META_GROUP[s] === "finished"`) because `dropped` is in the
 *  finished bucket but must NOT trigger the finish-date prompt. */
export const COMPLETION_STATUSES: Record<ItemStatus, boolean> = {
  wishlisted: false,
  backlogged: false,
  playing: false,
  paused: false,
  played: true,
  beaten: true,
  completed: true,
};
