import type { MediaType } from "@shelfie/shared";
import { MEDIA_TYPES } from "@shelfie/shared";
import type { LibrarySort, SortDirection } from "../library/librarySorting";
import { NATURAL_DIRECTION } from "../library/librarySorting";
import type { AutoList, ListGrouping } from "./automaticLists";

export type ListView = "shelf" | "list";

export interface ListViewState {
  view: ListView;
  sort: LibrarySort;
  dir: SortDirection;
  group: ListGrouping;
}

export const SORT_OPTIONS: readonly [LibrarySort, string][] = [
  ["recent", "Last interaction"],
  ["added", "Date added"],
  ["completed", "Last finished"],
  ["rating", "Rating"],
  ["excitement", "Excitement"],
  ["release", "Release date"],
  ["progress", "Progress"],
  ["title", "A–Z"],
  ["type", "Type"],
];

export const GROUPING_OPTIONS: readonly [ListGrouping, string][] = [
  ["status", "Status"],
  ["type", "Type"],
  ["none", "None"],
];

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : null;
}

const SORTS = SORT_OPTIONS.map(([sort]) => sort);
const DIRECTIONS: readonly SortDirection[] = ["asc", "desc"];
const VIEWS: readonly ListView[] = ["shelf", "list"];
const GROUPINGS = GROUPING_OPTIONS.map(([group]) => group);

/** `?type=` as a media type, or null (all media) when absent or unknown. */
export function parseMediaType(value: string | null): MediaType | null {
  return oneOf(value, MEDIA_TYPES);
}

/**
 * Resolves a list's view state: URL params win, then the viewer's last
 * choice for this list, then the list's own defaults. A direction only
 * carries over alongside the sort it was chosen for — picking a new sort in
 * the URL without `dir` reads that sort in its natural direction.
 */
export function resolveListViewState(
  params: URLSearchParams,
  stored: Partial<Record<keyof ListViewState, unknown>> | null,
  list: AutoList,
): ListViewState {
  const urlSort = oneOf(params.get("sort"), SORTS);
  const urlDir = oneOf(params.get("dir"), DIRECTIONS);
  const storedSort = oneOf(stored?.sort, SORTS);

  let sort: LibrarySort;
  let dir: SortDirection;
  if (urlSort) {
    sort = urlSort;
    dir = urlDir ?? NATURAL_DIRECTION[sort];
  } else if (storedSort) {
    sort = storedSort;
    dir = urlDir ?? oneOf(stored?.dir, DIRECTIONS) ?? NATURAL_DIRECTION[sort];
  } else {
    sort = list.defaultSort;
    dir = urlDir ?? list.defaultDirection ?? NATURAL_DIRECTION[sort];
  }

  return {
    view:
      oneOf(params.get("view"), VIEWS) ?? oneOf(stored?.view, VIEWS) ?? "shelf",
    sort,
    dir,
    group:
      oneOf(params.get("group"), GROUPINGS) ??
      oneOf(stored?.group, GROUPINGS) ??
      list.defaultGrouping,
  };
}

function storageKey(list: AutoList): string {
  return `shelfie:list-view:${list.id}`;
}

export function readStoredViewState(
  list: AutoList,
): Partial<Record<keyof ListViewState, unknown>> | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(storageKey(list)) ?? "null",
    );
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function storeViewState(list: AutoList, state: ListViewState): void {
  try {
    localStorage.setItem(storageKey(list), JSON.stringify(state));
  } catch {
    // Storage full or blocked: the URL still carries the state.
  }
}
