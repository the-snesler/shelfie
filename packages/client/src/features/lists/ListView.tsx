import type {
  ItemStatus,
  LibraryItem,
  MediaType,
  OwnerSettings,
} from "@shelfie/shared";
import { ITEM_STATUSES, MEDIA_TYPES, STATUS_META_GROUP } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router";
import IconArrowLeft from "~icons/tabler/arrow-left";
import IconLayoutGrid from "~icons/tabler/layout-grid";
import IconList from "~icons/tabler/list";
import IconSortAscending from "~icons/tabler/sort-ascending";
import IconSortDescending from "~icons/tabler/sort-descending";
import type { AppOutletContext } from "../../App";
import type { ShelfieDatabase } from "../../db/database";
import { refreshCardCaches } from "../../db/refreshCards";
import { cardCaption } from "../library/libraryCaptions";
import { LibraryItemCard } from "../library/LibraryItemCard";
import {
  compareLibraryItems,
  lastCompletedDate,
  NATURAL_DIRECTION,
  type LibrarySort,
} from "../library/librarySorting";
import { excitementLabel, statusLabel } from "../media/status";
import type { CardMeta } from "../media/useLibraryData";
import { useLibraryData } from "../media/useLibraryData";
import {
  findList,
  listMembers,
  type AutoList,
  type ListGrouping,
} from "./automaticLists";
import { ListHeaderRow, ListRow } from "./ListRow";
import { emptyTypeCounts, listStats, type ListStats } from "./listStats";
import {
  GROUPING_OPTIONS,
  parseMediaType,
  readStoredViewState,
  resolveListViewState,
  SORT_OPTIONS,
  storeViewState,
  type ListView as ListViewMode,
  type ListViewState,
} from "./listViewState";
import { MediaFilter } from "./MediaFilter";
import { useListContext } from "./useListContext";

/** Items rendered per chunk; more mount as the end scrolls into view. Game
 *  case art is heavy enough that a 500-title "Done" list shouldn't mount
 *  in one go. */
const CHUNK = 60;

const MEDIA_LABELS: Record<MediaType, string> = {
  movie: "Movies",
  tv: "TV Shows",
  book: "Books",
  game: "Games",
};

const SELECT_CLASS =
  "rounded-md border border-divider bg-panel px-2 py-1.5 text-sm text-ink outline-none focus:border-accent";

export default function ListViewRoute() {
  const { listId = "" } = useParams();
  const list = useMemo(() => findList(listId), [listId]);
  if (!list) {
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-24 text-center text-muted">
        <p className="font-display text-2xl text-ink">No such list</p>
        <Link to="/lists" className="text-sm text-accent hover:underline">
          Back to Lists
        </Link>
      </div>
    );
  }
  return <ListPage key={list.id} list={list} />;
}

interface Section {
  key: string;
  label: string | null;
  items: RxDocument<LibraryItem>[];
}

function ListPage({ list }: { list: AutoList }) {
  const { db, settings } = useOutletContext<AppOutletContext>();
  const { items, cards } = useLibraryData(db);
  const ctx = useListContext(cards);
  const [searchParams, setSearchParams] = useSearchParams();
  const type = parseMediaType(searchParams.get("type"));
  const [stored] = useState(() => readStoredViewState(list));
  const state = resolveListViewState(searchParams, stored, list);

  function update(patch: Partial<ListViewState>) {
    const next: ListViewState = { ...state, ...patch };
    if (patch.sort && !patch.dir) next.dir = NATURAL_DIRECTION[patch.sort];
    storeViewState(list, next);
    setSearchParams(
      (params) => {
        const out = new URLSearchParams(params);
        for (const [key, value] of Object.entries(next)) out.set(key, value);
        return out;
      },
      { replace: true },
    );
  }

  // An item whose log popover is open stays put (in the status section it
  // started in) even when the edit moves it out of this list, so the
  // popover isn't torn down mid-edit. It leaves once the popover closes.
  const [pinned, setPinned] = useState<ReadonlyMap<string, ItemStatus>>(
    () => new Map(),
  );
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const onLogOpenChange = useCallback((itemId: string, open: boolean) => {
    setPinned((current) => {
      if (open === current.has(itemId)) return current;
      const next = new Map(current);
      if (open) {
        const status = itemsRef.current.find((i) => i.id === itemId)?.status;
        if (status) next.set(itemId, status);
      } else {
        next.delete(itemId);
      }
      return next;
    });
  }, []);

  const allMembers = useMemo(() => {
    const members = listMembers(list, items, null, ctx);
    if (pinned.size === 0) return members;
    const ids = new Set(members.map((item) => item.id));
    const kept = items.filter(
      (item) => pinned.has(item.id) && !ids.has(item.id),
    );
    return [...members, ...kept];
  }, [list, items, ctx, pinned]);

  const typeCounts = useMemo(() => {
    const counts = emptyTypeCounts();
    for (const item of allMembers) counts[item.mediaType] += 1;
    return counts;
  }, [allMembers]);

  const members = useMemo(
    () =>
      type ? allMembers.filter((item) => item.mediaType === type) : allMembers,
    [allMembers, type],
  );

  const membersKey = members
    .map((item) => item.id)
    .sort()
    .join(",");
  useEffect(() => {
    // Home only warms unfinished titles' cards; warm this list's.
    void refreshCardCaches(db, members);
    // membersKey is the stable dependency; members only matter via ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, membersKey]);

  const sections = useMemo(
    () =>
      groupSections(
        [...members].sort((a, b) =>
          compareLibraryItems(a, b, state.sort, cards, state.dir),
        ),
        state.group,
        type,
        pinned,
      ),
    [members, cards, state.sort, state.dir, state.group, type, pinned],
  );

  const stats = useMemo(() => listStats(members), [members]);
  const singleMedium = list.mediaTypes?.length === 1;
  const label = list.label(type);
  const Icon = list.icon;

  return (
    <div
      className="library-wall min-h-full"
      data-library-theme={settings.libraryTheme}
    >
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 px-5 py-8 md:px-8">
        <div className="flex flex-col gap-3">
          <Link
            to={type && !singleMedium ? `/lists?type=${type}` : "/lists"}
            className="inline-flex w-fit items-center gap-1 text-sm text-muted hover:text-ink"
          >
            <IconArrowLeft className="size-4" />
            Lists
          </Link>
          <header className="flex flex-col gap-1">
            <div className="flex min-w-0 items-baseline gap-3">
              <h1 className="flex items-center gap-2 font-display text-3xl font-semibold tracking-tight text-ink">
                <Icon className="size-7 shrink-0 text-accent" />
                {label}
              </h1>
              <span className="text-sm text-faint tabular-nums">
                {members.length}
              </span>
            </div>
            <p className="text-sm text-muted">{list.description(type)}</p>
          </header>
          {members.length > 0 && <StatsStrip stats={stats} />}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {singleMedium ? (
            <span />
          ) : (
            <MediaFilter type={type} counts={typeCounts} />
          )}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted">
              Group
              <select
                value={state.group}
                onChange={(event) =>
                  update({ group: event.currentTarget.value as ListGrouping })
                }
                className={SELECT_CLASS}
              >
                {GROUPING_OPTIONS.map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-1">
              <label className="flex items-center gap-2 text-xs text-muted">
                Sort
                <select
                  value={state.sort}
                  onChange={(event) =>
                    update({ sort: event.currentTarget.value as LibrarySort })
                  }
                  className={SELECT_CLASS}
                >
                  {SORT_OPTIONS.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() =>
                  update({ dir: state.dir === "asc" ? "desc" : "asc" })
                }
                aria-label={
                  state.dir === "asc" ? "Sorted ascending" : "Sorted descending"
                }
                title={state.dir === "asc" ? "Ascending" : "Descending"}
                className="rounded-md border border-divider bg-panel p-1.5 text-muted hover:text-ink"
              >
                {state.dir === "asc" ? (
                  <IconSortAscending className="size-4" />
                ) : (
                  <IconSortDescending className="size-4" />
                )}
              </button>
            </div>
            <ViewToggle
              view={state.view}
              onChange={(view) => update({ view })}
            />
          </div>
        </div>

        {members.length === 0 ? (
          <EmptyState
            list={list}
            type={type}
            otherCount={allMembers.length}
            onShowAll={() =>
              setSearchParams(
                (params) => {
                  const out = new URLSearchParams(params);
                  out.delete("type");
                  return out;
                },
                { replace: true },
              )
            }
          />
        ) : (
          <ListBody
            key={`${type}|${state.sort}|${state.dir}|${state.group}|${state.view}`}
            db={db}
            sections={sections}
            cards={cards}
            view={state.view}
            sort={state.sort}
            settings={settings}
            onLogOpenChange={onLogOpenChange}
          />
        )}
      </div>
    </div>
  );
}

function groupSections(
  sorted: RxDocument<LibraryItem>[],
  grouping: ListGrouping,
  type: MediaType | null,
  pinned: ReadonlyMap<string, ItemStatus>,
): Section[] {
  if (grouping === "none") return [{ key: "all", label: null, items: sorted }];
  if (grouping === "type") {
    return MEDIA_TYPES.map((mediaType) => ({
      key: mediaType,
      label: MEDIA_LABELS[mediaType],
      items: sorted.filter((item) => item.mediaType === mediaType),
    })).filter((section) => section.items.length > 0);
  }
  const statusOf = (item: LibraryItem) => pinned.get(item.id) ?? item.status;
  return ITEM_STATUSES.map((status) => ({
    key: status,
    label: statusLabel(status, type),
    items: sorted.filter((item) => statusOf(item) === status),
  })).filter((section) => section.items.length > 0);
}

function StatsStrip({ stats }: { stats: ListStats }) {
  const parts: string[] = [];
  if (stats.avgRating != null) {
    parts.push(
      `★ ${stats.avgRating.toFixed(1)} avg · ${stats.ratedCount} rated`,
    );
  } else {
    parts.push("None rated");
  }
  if (stats.hoursLogged > 0) {
    parts.push(`${Math.round(stats.hoursLogged).toLocaleString()} h logged`);
  }
  if (stats.completions > 0) {
    parts.push(
      `${stats.completions} ${stats.completions === 1 ? "completion" : "completions"}`,
    );
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {parts.map((part) => (
        <li
          key={part}
          className="rounded-full border border-divider bg-panel/80 px-2.5 py-0.5 text-xs text-muted tabular-nums"
        >
          {part}
        </li>
      ))}
    </ul>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ListViewMode;
  onChange: (view: ListViewMode) => void;
}) {
  const options = [
    { value: "shelf", label: "Shelf", Icon: IconLayoutGrid },
    { value: "list", label: "List", Icon: IconList },
  ] as const;
  return (
    <div className="flex gap-1 rounded-md bg-well p-1" role="group">
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          title={label}
          onClick={() => onChange(value)}
          className={
            view === value
              ? "flex items-center gap-1.5 rounded bg-accent px-2 py-1 text-sm font-medium text-accent-ink"
              : "flex items-center gap-1.5 rounded px-2 py-1 text-sm text-muted hover:text-ink"
          }
        >
          <Icon className="size-4" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

function EmptyState({
  list,
  type,
  otherCount,
  onShowAll,
}: {
  list: AutoList;
  type: MediaType | null;
  otherCount: number;
  onShowAll: () => void;
}) {
  const hint =
    list.section === "status" || list.section === "group"
      ? "Set a title's status from its page or its + button on the shelf, and it'll show up here."
      : list.section === "platform"
        ? "Log a game on this platform from its page to add it here."
        : "This list fills itself as you log, rate, and finish things.";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center text-muted">
      <p className="font-display text-2xl text-ink">Nothing here yet</p>
      <p className="max-w-md text-sm">{list.description(type)}</p>
      <p className="max-w-md text-sm text-faint">{hint}</p>
      {type && otherCount > 0 && (
        <button
          type="button"
          onClick={onShowAll}
          className="mt-2 text-sm text-accent hover:underline"
        >
          Show {otherCount} in other media
        </button>
      )}
    </div>
  );
}

function shortIsoDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Shelf caption that follows the sort, so the order is legible: finish
 *  date when sorted by it, added date likewise, else the usual caption. */
function shelfCaption(
  item: LibraryItem,
  meta: CardMeta | undefined,
  sort: LibrarySort,
): string | null {
  if (sort === "completed") {
    const last = lastCompletedDate(item);
    if (last) return shortIsoDate(last);
  }
  if (sort === "excitement") {
    const label = excitementLabel(item.excitement);
    if (label) return label;
  }
  if (sort === "added") {
    return `Added ${new Date(item.addedAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })}`;
  }
  return cardCaption(item, meta);
}

function ListBody({
  db,
  sections,
  cards,
  view,
  sort,
  settings,
  onLogOpenChange,
}: {
  db: ShelfieDatabase;
  sections: Section[];
  cards: Map<string, CardMeta>;
  view: ListViewMode;
  sort: LibrarySort;
  settings: OwnerSettings;
  onLogOpenChange: (itemId: string, open: boolean) => void;
}) {
  const [limit, setLimit] = useState(CHUNK);
  const sentinel = useRef<HTMLDivElement>(null);
  const total = sections.reduce((sum, s) => sum + s.items.length, 0);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || limit >= total) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setLimit((current) => current + CHUNK);
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [limit, total]);

  let budget = limit;
  const visible = sections
    .map((section) => {
      const shown = section.items.slice(0, Math.max(0, budget));
      budget -= shown.length;
      return { ...section, shown };
    })
    .filter((section) => section.shown.length > 0);

  return (
    <div className="flex flex-col gap-10">
      {visible.map((section) => (
        <section key={section.key} className="flex flex-col">
          {section.label && (
            <h2 className="mb-2 font-display text-xl font-medium text-ink">
              {section.label}
              <span className="ml-2 text-sm font-normal text-faint">
                {section.items.length}
              </span>
            </h2>
          )}
          {view === "shelf" ? (
            <div className="shelf-rows flex flex-wrap items-start gap-x-6">
              {section.shown.map((item) => (
                <LibraryItemCard
                  key={item.id}
                  db={db}
                  item={item}
                  meta={cards.get(item.id)}
                  caption={shelfCaption(item, cards.get(item.id), sort)}
                  showProgressBar={settings.showProgressBars}
                  onLogOpenChange={onLogOpenChange}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col rounded-lg border border-divider bg-panel/85 py-2">
              <ListHeaderRow
                planned={section.shown.every(
                  (item) => STATUS_META_GROUP[item.status] === "planned",
                )}
              />
              {section.shown.map((item) => (
                <ListRow
                  key={item.id}
                  db={db}
                  item={item}
                  meta={cards.get(item.id)}
                  onLogOpenChange={onLogOpenChange}
                />
              ))}
            </div>
          )}
        </section>
      ))}
      {limit < total && <div ref={sentinel} className="h-px" aria-hidden />}
    </div>
  );
}
