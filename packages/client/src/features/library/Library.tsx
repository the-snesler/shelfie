import type { LibraryItem, MediaType } from "@shelfie/shared";
import { MEDIA_TYPES, STATUS_META_GROUP } from "@shelfie/shared";
import { motion } from "motion/react";
import type { RxDocument } from "rxdb";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router";
import IconChevronRight from "~icons/tabler/chevron-right";
import type { AppOutletContext } from "../../App";
import { groupListId } from "../lists/automaticLists";
import { listHref } from "../lists/listHref";
import { isCaughtUp } from "../media/caughtUp";
import { MEDIA_LIBRARY_COVER_WIDTH } from "../media/MediaCover";
import { releaseState } from "../media/release";
import { META_STATUS_LABELS } from "../media/status";
import { useToday } from "../media/useToday";
import { cardCaption, releaseCaption } from "./libraryCaptions";
import { LibraryItemCard } from "./LibraryItemCard";
import {
  comparePlannedItems,
  compareUnreleasedItems,
  normalizeManualOrder,
  shelfSection,
  SHELF_SECTIONS,
  type PlannedSort,
  type ShelfSection,
} from "./librarySorting";
import { useLibraryData } from "./useLibraryData";

const MEDIA_LABELS: Record<MediaType, string> = {
  movie: "Movies",
  tv: "TV Shows",
  book: "Books",
  game: "Games",
};

const SECTION_LABELS: Record<ShelfSection, string> = {
  ...META_STATUS_LABELS,
  wishlist: "Wishlist",
  unreleased: "Unreleased",
};

const PLANNED_SORT_KEY = "shelfie:planned-sort";
const PLANNED_ORDER_KEY = "shelfie:planned-order";

const PLANNED_SORT_OPTIONS: readonly [PlannedSort, string][] = [
  ["manual", "Manual"],
  ["recent", "Last interaction"],
  ["release", "Release date"],
  ["excitement", "Excitement"],
  ["title", "A–Z"],
  ["type", "Type"],
];

function storedPlannedSort(): PlannedSort {
  const value = localStorage.getItem(PLANNED_SORT_KEY);
  return PLANNED_SORT_OPTIONS.some(([sort]) => sort === value)
    ? (value as PlannedSort)
    : "recent";
}

function storedManualOrder(): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(PLANNED_ORDER_KEY) ?? "[]",
    );
    return Array.isArray(value) && value.every((id) => typeof id === "string")
      ? value
      : [];
  } catch {
    return [];
  }
}

export default function Library() {
  const { db, settings } = useOutletContext<AppOutletContext>();
  const { items, cards, tvCatalogs } = useLibraryData(db);
  const today = useToday();
  const [plannedSort, setPlannedSort] = useState(storedPlannedSort);
  const [manualOrder, setManualOrder] = useState(storedManualOrder);
  const draggedId = useRef<string | null>(null);

  const inProgressOrder = useRef<{ membership: string; ids: string[] }>({
    membership: "",
    ids: [],
  });
  const allInProgress = items.filter(
    (item) => STATUS_META_GROUP[item.status] === "in-progress",
  );
  const inProgressMembership = allInProgress
    .map((item) => item.id)
    .sort()
    .join("\n");
  if (inProgressOrder.current.membership !== inProgressMembership) {
    inProgressOrder.current = {
      membership: inProgressMembership,
      ids: [...allInProgress]
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
        .map((item) => item.id),
    };
  }

  const [searchParams] = useSearchParams();
  const typeParam = searchParams.get("type");
  const activeType = (MEDIA_TYPES as readonly string[]).includes(
    typeParam ?? "",
  )
    ? (typeParam as MediaType)
    : null;

  const filtered = useMemo(
    () =>
      activeType
        ? items.filter((item) => item.mediaType === activeType)
        : items,
    [items, activeType],
  );

  // Every planned-bucket item, including those shown under Unreleased, so a
  // title keeps its manual position while it waits for release.
  const plannedItems = useMemo(
    () => items.filter((item) => STATUS_META_GROUP[item.status] === "planned"),
    [items],
  );

  useEffect(() => {
    // The RxDB subscription emits after the first paint. Keep a stored manual
    // order intact during that brief empty snapshot instead of replacing it
    // with `[]` before the real library arrives.
    if (plannedItems.length === 0) return;
    setManualOrder((current) => normalizeManualOrder(current, plannedItems));
  }, [plannedItems]);

  useEffect(() => {
    localStorage.setItem(PLANNED_SORT_KEY, plannedSort);
  }, [plannedSort]);

  useEffect(() => {
    localStorage.setItem(PLANNED_ORDER_KEY, JSON.stringify(manualOrder));
  }, [manualOrder]);

  const grouped = useMemo(() => {
    const map = new Map<ShelfSection, RxDocument<LibraryItem>[]>();
    for (const item of filtered) {
      const g = shelfSection(
        item,
        cards.get(item.id),
        today,
        settings.separateWishlist,
      );
      const arr = map.get(g);
      if (arr) arr.push(item);
      else map.set(g, [item]);
    }
    const stableInProgressRank = new Map(
      inProgressOrder.current.ids.map((id, index) => [id, index]),
    );
    map
      .get("in-progress")
      ?.sort(
        (a, b) =>
          (stableInProgressRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (stableInProgressRank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );
    const manualRank = new Map(manualOrder.map((id, index) => [id, index]));
    // The Wishlist section is a slice of the planned bucket, so it follows
    // Planned's sort (and shares its manual order).
    for (const section of ["planned", "wishlist"] as const) {
      map
        .get(section)
        ?.sort((a, b) =>
          plannedSort === "manual"
            ? (manualRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
              (manualRank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
            : comparePlannedItems(a, b, plannedSort, cards),
        );
    }
    map
      .get("unreleased")
      ?.sort((a, b) => compareUnreleasedItems(a, b, cards, today));
    return map;
  }, [
    filtered,
    cards,
    manualOrder,
    plannedSort,
    today,
    settings.separateWishlist,
  ]);

  function moveManualItem(overId: string) {
    const fromId = draggedId.current;
    if (!fromId || fromId === overId) return;
    setManualOrder((current) => {
      const next = normalizeManualOrder(current, plannedItems);
      const from = next.indexOf(fromId);
      const to = next.indexOf(overId);
      if (from < 0 || to < 0) return current;
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
  }

  const heading = activeType ? MEDIA_LABELS[activeType] : "Library";

  return (
    <div
      className="library-wall min-h-full"
      data-library-theme={settings.libraryTheme}
    >
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-10 px-5 py-8 md:px-8">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
              {heading}
            </h1>
            <span className="text-sm text-faint">
              {filtered.length} on the shelf
            </span>
          </div>
        </header>
        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 pb-16 text-center text-muted">
            <p className="font-display text-2xl text-ink">
              Your shelf is empty
            </p>
            <p className="text-sm">
              Search for a game, movie, show, or book to add your first one.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted">
            <p className="font-display text-xl text-ink">
              No {heading.toLowerCase()} on your shelf yet
            </p>
            <p className="text-sm">Find some with the search bar.</p>
          </div>
        ) : (
          SHELF_SECTIONS.filter((g) => grouped.get(g)?.length).map((g) => {
            const sectionItems = grouped.get(g)!;
            // Paused titles and caught-up shows stay counted in In Progress
            // but collapse into tiles at the end; the tiles list them in full.
            const isPaused = (item: LibraryItem) => item.status === "paused";
            const caughtUp = (item: LibraryItem) =>
              isCaughtUp(item, cards.get(item.id), today);
            const shownItems =
              g === "in-progress"
                ? sectionItems.filter(
                    (item) => !isPaused(item) && !caughtUp(item),
                  )
                : sectionItems;
            const collapsed =
              g === "in-progress"
                ? [
                    {
                      listId: "paused",
                      count: sectionItems.filter(isPaused).length,
                      label: (n: number) =>
                        `paused ${n === 1 ? "item" : "items"}`,
                    },
                    {
                      listId: "caught-up",
                      count: sectionItems.filter(caughtUp).length,
                      label: () => "caught up",
                    },
                  ].filter((tile) => tile.count > 0)
                : [];
            const manualDrag =
              (g === "planned" || g === "wishlist") && plannedSort === "manual";
            return (
              <section key={g} className="flex flex-col">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-display text-xl font-medium text-ink">
                    {SECTION_LABELS[g]}
                    <span className="ml-2 text-sm font-normal text-faint">
                      {sectionItems.length}
                    </span>
                  </h2>
                  <div className="flex items-center gap-4">
                    {g === "planned" && (
                      <label className="flex items-center gap-2 text-xs text-muted">
                        Sort
                        <select
                          value={plannedSort}
                          onChange={(event) =>
                            setPlannedSort(
                              event.currentTarget.value as PlannedSort,
                            )
                          }
                          className="rounded-md border border-divider bg-panel px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                        >
                          {PLANNED_SORT_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {g !== "unreleased" && (
                      <Link
                        to={listHref(
                          g === "wishlist" ? "wishlisted" : groupListId(g),
                          activeType,
                        )}
                        className="inline-flex items-center gap-0.5 text-sm text-muted hover:text-accent"
                      >
                        See all
                        <IconChevronRight className="size-4" />
                      </Link>
                    )}
                  </div>
                </div>
                <div className="shelf-rows -mt-2 flex flex-wrap items-start gap-x-6">
                  {shownItems.map((item) => (
                    <motion.div
                      key={item.id}
                      layout="position"
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 38,
                      }}
                      draggable={manualDrag}
                      onDragStart={() => {
                        draggedId.current = item.id;
                      }}
                      onDragEnd={() => {
                        draggedId.current = null;
                      }}
                      onDragOver={(event) => {
                        if (manualDrag) {
                          event.preventDefault();
                        }
                      }}
                      onDrop={() => moveManualItem(item.id)}
                      className={
                        manualDrag
                          ? "cursor-grab active:cursor-grabbing"
                          : undefined
                      }
                    >
                      <LibraryItemCard
                        db={db}
                        item={item}
                        meta={cards.get(item.id)}
                        caption={
                          g === "unreleased"
                            ? releaseCaption(
                                releaseState(item, cards.get(item.id), today),
                                today,
                              )
                            : cardCaption(item, cards.get(item.id))
                        }
                        catalog={
                          item.mediaType === "tv"
                            ? tvCatalogs.get(item.id)
                            : undefined
                        }
                        showProgressBar={settings.showProgressBars}
                      />
                    </motion.div>
                  ))}
                  {collapsed.map((tile) => (
                    <motion.div
                      key={tile.listId}
                      layout="position"
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 38,
                      }}
                      className="flex items-end"
                      style={{ height: "var(--shelf-cover-h)" }}
                    >
                      <Link
                        to={listHref(tile.listId, activeType)}
                        className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-faint/60 text-muted transition-colors hover:border-accent hover:text-accent"
                        style={{
                          width: `${MEDIA_LIBRARY_COVER_WIDTH}px`,
                          aspectRatio: "2 / 3",
                        }}
                      >
                        <span className="font-display text-4xl font-semibold">
                          +{tile.count}
                        </span>
                        <span className="text-xs">
                          {tile.label(tile.count)}
                        </span>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
