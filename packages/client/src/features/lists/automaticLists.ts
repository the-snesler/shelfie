import type {
  ItemStatus,
  LibraryItem,
  MediaType,
  MetaStatus,
} from "@shelfie/shared";
import { ITEM_STATUSES, STATUS_META_GROUP } from "@shelfie/shared";
import type { FunctionComponent, SVGProps } from "react";
import IconBolt from "~icons/tabler/bolt";
import IconCalendarCheck from "~icons/tabler/calendar-check";
import IconCircleCheck from "~icons/tabler/circle-check";
import IconDeviceGamepad2 from "~icons/tabler/device-gamepad-2";
import IconHourglassLow from "~icons/tabler/hourglass-low";
import IconPlayerPlay from "~icons/tabler/player-play";
import IconRepeat from "~icons/tabler/repeat";
import IconStack2 from "~icons/tabler/stack-2";
import IconStar from "~icons/tabler/star";
import IconStarFilled from "~icons/tabler/star-filled";
import type { LibrarySort, SortDirection } from "../library/librarySorting";
import { lastCompletedDate } from "../library/librarySorting";
import { STATUS_ICONS, STATUSES_BY_MEDIA, statusLabel } from "../media/status";

type IconComponent = FunctionComponent<SVGProps<SVGSVGElement>>;

/** Index-page section a list is filed under, in display order. */
export const LIST_SECTIONS = ["group", "status", "smart", "platform"] as const;
export type ListSection = (typeof LIST_SECTIONS)[number];

export const LIST_SECTION_LABELS: Record<ListSection, string> = {
  group: "By progress",
  status: "By status",
  smart: "Highlights",
  platform: "By platform",
};

/** Within-list sub-sectioning. */
export type ListGrouping = "status" | "type" | "none";

export interface ListContext {
  /** ms epoch, for "untouched in N days" rules. */
  now: number;
  /** Viewer's local ISO day (see `useToday`). */
  today: string;
}

/**
 * An automatic list: a named, always-current query over the library. Lists
 * are defined by a predicate rather than stored membership, so nothing about
 * them is synced — they follow whatever status/rating/dates the items have.
 */
export interface AutoList {
  /** URL segment under `/lists/`; stable, human-readable. */
  id: string;
  section: ListSection;
  icon: IconComponent;
  /** Name for the active media filter (null = all media). */
  label(type: MediaType | null): string;
  /** One-line explanation, shown under the title and in the empty state. */
  description(type: MediaType | null): string;
  matches(item: LibraryItem, ctx: ListContext): boolean;
  /** Restricts the list to some media types; every type when omitted. */
  mediaTypes?: readonly MediaType[];
  /** The status list's status, for per-media visibility. */
  status?: ItemStatus;
  defaultSort: LibrarySort;
  /** Defaults to the sort's natural direction. */
  defaultDirection?: SortDirection;
  defaultGrouping: ListGrouping;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back "Recently finished" reaches, and how long an in-progress
 *  title can sit untouched before it is "Gathering dust". */
export const RECENT_DAYS = 90;
export const DUSTY_DAYS = 90;

const NOUNS: Record<MediaType, string> = {
  game: "Games",
  movie: "Movies",
  tv: "Shows",
  book: "Books",
};

function noun(type: MediaType | null): string {
  return type ? NOUNS[type] : "Titles";
}

const VERBING: Record<MediaType, string> = {
  game: "playing",
  movie: "watching",
  tv: "watching",
  book: "reading",
};

const GROUP_LABELS: Record<MetaStatus, string> = {
  planned: "Planned",
  "in-progress": "In Progress",
  // A list title, unlike the Home section: this bucket also holds dropped
  // titles, which "Finished" would misdescribe.
  finished: "Done",
};

const GROUP_IDS: Record<MetaStatus, string> = {
  planned: "planned",
  "in-progress": "in-progress",
  finished: "done",
};

/** The `/lists/:id` for a Home shelf section's bucket. */
export function groupListId(group: MetaStatus): string {
  return GROUP_IDS[group];
}

const GROUP_DESCRIPTIONS: Record<
  MetaStatus,
  (type: MediaType | null) => string
> = {
  planned: (type) => `${noun(type)} on your wishlist or backlog.`,
  "in-progress": (type) =>
    `${noun(type)} you're in the middle of, including paused ones.`,
  finished: (type) =>
    `${noun(type)} you've finished, completed, or put down for good.`,
};

const GROUP_SORTS: Record<MetaStatus, LibrarySort> = {
  planned: "recent",
  "in-progress": "recent",
  finished: "completed",
};

function groupList(group: MetaStatus): AutoList {
  return {
    id: GROUP_IDS[group],
    section: "group",
    icon:
      group === "planned"
        ? IconStack2
        : group === "in-progress"
          ? IconPlayerPlay
          : IconCircleCheck,
    label: () => GROUP_LABELS[group],
    description: GROUP_DESCRIPTIONS[group],
    matches: (item) => STATUS_META_GROUP[item.status] === group,
    defaultSort: GROUP_SORTS[group],
    defaultGrouping: "status",
  };
}

const STATUS_DESCRIPTIONS: Record<
  ItemStatus,
  (type: MediaType | null) => string
> = {
  wishlisted: (type) => `${noun(type)} you want but don't have yet.`,
  backlogged: (type) =>
    type === "game"
      ? "Games you own and plan to play."
      : type
        ? `${noun(type)} you plan to ${type === "book" ? "read" : "watch"}.`
        : "Titles you're planning to get to.",
  active: (type) =>
    type
      ? `${noun(type)} you're ${VERBING[type]} right now.`
      : "Titles you're playing, watching, or reading right now.",
  paused: (type) =>
    `${noun(type)} you've set aside for now but mean to come back to.`,
  dropped: (type) => {
    switch (type) {
      case "game":
        return "Games you've stopped playing without beating them.";
      case "movie":
        return "Movies you stopped partway through.";
      case "tv":
        return "Shows you stopped watching.";
      case "book":
        return "Books you put down before the end.";
      case null:
        return "Titles you stopped without finishing.";
    }
  },
  finished: (type) => {
    switch (type) {
      case "game":
        return "Games you've beaten.";
      case "movie":
        return "Movies you've watched.";
      case "tv":
        return "Shows you've watched to the end.";
      case "book":
        return "Books you've read.";
      case null:
        return "Titles you've seen through to the end.";
    }
  },
  completed: () => "Games you've completed 100%.",
};

const STATUS_SORTS: Record<ItemStatus, LibrarySort> = {
  wishlisted: "release",
  backlogged: "added",
  active: "recent",
  paused: "recent",
  dropped: "recent",
  finished: "completed",
  completed: "completed",
};

function statusList(status: ItemStatus): AutoList {
  return {
    id: status,
    section: "status",
    icon: STATUS_ICONS[status],
    status,
    label: (type) => statusLabel(status, type),
    description: STATUS_DESCRIPTIONS[status],
    matches: (item) => item.status === status,
    defaultSort: STATUS_SORTS[status],
    defaultGrouping: "none",
  };
}

function daysBefore(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00`);
  date.setDate(date.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const REVISITED: Record<MediaType, string> = {
  game: "Replayed",
  movie: "Rewatched",
  tv: "Rewatched",
  book: "Reread",
};

/** Lowest excitement level that puts a planned title on "Up next". */
export const UP_NEXT_MIN_EXCITEMENT = 3;

const SMART_LISTS: readonly AutoList[] = [
  {
    id: "up-next",
    section: "smart",
    icon: IconBolt,
    label: () => "Up next",
    description: (type) =>
      `${noun(type)} on your wishlist or backlog you're keen to get to soon.`,
    matches: (item) =>
      STATUS_META_GROUP[item.status] === "planned" &&
      item.excitement != null &&
      item.excitement >= UP_NEXT_MIN_EXCITEMENT,
    defaultSort: "excitement",
    defaultGrouping: "none",
  },
  {
    id: "recently-finished",
    section: "smart",
    icon: IconCalendarCheck,
    label: () => "Recently finished",
    description: (type) =>
      `${noun(type)} you finished in the last ${RECENT_DAYS} days.`,
    matches: (item, { today }) => {
      const last = lastCompletedDate(item);
      return last != null && last >= daysBefore(today, RECENT_DAYS);
    },
    defaultSort: "completed",
    defaultGrouping: "none",
  },
  {
    id: "unrated",
    section: "smart",
    icon: IconStar,
    label: () => "Needs a rating",
    description: (type) => `${noun(type)} you've finished but haven't rated.`,
    matches: (item) =>
      (item.status === "finished" || item.status === "completed") &&
      item.rating == null,
    defaultSort: "completed",
    defaultGrouping: "none",
  },
  {
    id: "top-rated",
    section: "smart",
    icon: IconStarFilled,
    label: () => "Top rated",
    description: (type) => `${noun(type)} you've rated 4½ stars or higher.`,
    matches: (item) => item.rating != null && item.rating >= 4.5,
    defaultSort: "rating",
    defaultGrouping: "none",
  },
  {
    id: "dusty",
    section: "smart",
    icon: IconHourglassLow,
    label: () => "Gathering dust",
    description: (type) =>
      `${noun(type)} in progress that you haven't touched in ${DUSTY_DAYS}+ days.`,
    matches: (item, { now }) =>
      STATUS_META_GROUP[item.status] === "in-progress" &&
      item.updatedAt < now - DUSTY_DAYS * DAY_MS,
    defaultSort: "recent",
    defaultDirection: "asc",
    defaultGrouping: "none",
  },
  {
    id: "revisited",
    section: "smart",
    icon: IconRepeat,
    label: (type) => (type ? REVISITED[type] : "Revisited"),
    description: (type) => `${noun(type)} you've finished more than once.`,
    matches: (item) => item.completedDates.length > 1,
    defaultSort: "completed",
    defaultGrouping: "none",
  },
];

const PLATFORM_PREFIX = "platform:";

function platformList(platform: string): AutoList {
  return {
    id: `${PLATFORM_PREFIX}${platform}`,
    section: "platform",
    icon: IconDeviceGamepad2,
    mediaTypes: ["game"],
    label: () => platform,
    description: () => `Games you've logged on ${platform}.`,
    matches: (item) =>
      item.mediaType === "game" && item.platforms.includes(platform),
    defaultSort: "recent",
    defaultGrouping: "status",
  };
}

/** Lists that exist whatever is in the library. */
export const STATIC_LISTS: readonly AutoList[] = [
  ...(["planned", "in-progress", "finished"] as const).map(groupList),
  ...ITEM_STATUSES.map(statusList),
  ...SMART_LISTS,
];

/** Every platform any game in the library is logged on, A–Z. */
function libraryPlatforms(items: readonly LibraryItem[]): string[] {
  const platforms = new Set<string>();
  for (const item of items) {
    if (item.mediaType !== "game") continue;
    for (const platform of item.platforms) platforms.add(platform);
  }
  return [...platforms].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

/** Every list, including one per platform in use. */
export function allLists(items: readonly LibraryItem[]): AutoList[] {
  return [...STATIC_LISTS, ...libraryPlatforms(items).map(platformList)];
}

/** Resolves a `/lists/:id` param. Platform lists resolve even when no game
 *  is on that platform any more, so the page shows empty rather than 404. */
export function findList(id: string): AutoList | null {
  if (id.startsWith(PLATFORM_PREFIX)) {
    const platform = id.slice(PLATFORM_PREFIX.length);
    return platform ? platformList(platform) : null;
  }
  return STATIC_LISTS.find((list) => list.id === id) ?? null;
}

export function listAppliesTo(list: AutoList, type: MediaType | null) {
  return type == null || !list.mediaTypes || list.mediaTypes.includes(type);
}

/** Items in `list` under the media filter, unsorted. */
export function listMembers<T extends LibraryItem>(
  list: AutoList,
  items: readonly T[],
  type: MediaType | null,
  ctx: ListContext,
): T[] {
  if (!listAppliesTo(list, type)) return [];
  return items.filter(
    (item) =>
      (type == null || item.mediaType === type) &&
      (!list.mediaTypes || list.mediaTypes.includes(item.mediaType)) &&
      list.matches(item, ctx),
  );
}

/**
 * Whether the index shows `list` under the media filter. A status a media
 * type doesn't offer (e.g. Paused for movies) is hidden — unless something
 * already has it (say, from an import), so no item becomes unreachable.
 */
export function listVisible(
  list: AutoList,
  type: MediaType | null,
  memberCount: number,
): boolean {
  if (!listAppliesTo(list, type)) return false;
  if (type && list.status && !STATUSES_BY_MEDIA[type].includes(list.status)) {
    return memberCount > 0;
  }
  return true;
}
