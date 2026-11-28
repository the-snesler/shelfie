import type { LibraryItem, MediaType } from "@tsundo/shared";
import { MEDIA_TYPES, STATUS_META_GROUP } from "@tsundo/shared";
import { motion } from "motion/react";
import type { RxDocument } from "rxdb";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router";
import IconChevronRight from "~icons/tabler/chevron-right";
import type { AppOutletContext } from "../../App";
import { GuestEmptyShelf, GuestShelfNotice } from "../demo/GuestShelf";
import { groupListId } from "../lists/automaticLists";
import { listHref } from "../lists/listHref";
import { isCaughtUp } from "../media/caughtUp";
import { MEDIA_LIBRARY_COVER_WIDTH } from "../media/MediaCover";
import { releaseState } from "../media/release";
import { META_STATUS_LABELS } from "../media/status";
import { useToday } from "../media/useToday";
import { cardCaption, releaseCaption } from "./libraryCaptions";
import { LibraryItemCard } from "./LibraryItemCard";
import { libraryItemLink } from "./libraryItemLink";
import {
  RandomPickButton,
  useRandomPick,
  type RandomPickCandidate,
} from "./RandomPickButton";
import {
  comparePlannedItems,
  compareUnreleasedItems,
  normalizeManualOrder,
  shelfSection,
  SHELF_SECTIONS,
  type PlannedSort,
  type ShelfSection,
} from "./librarySorting";
import { PLANNED_SORT_OPTIONS, PlannedSortMenu } from "./PlannedSortMenu";
import { useCompactShelf, useShelfScale } from "./shelfScale";
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

const PLANNED_SORT_KEY = "tsundo:planned-sort";
const PLANNED_ORDER_KEY = "tsundo:planned-order";

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

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export default function Library() {
  const { db, settings, authenticated } = useOutletContext<AppOutletContext>();
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
    // Keep the old array when nothing moved: a new one re-renders the whole
    // shelf, and on the way back from a detail page that extra render lands
    // inside the view transition's frozen update callback.
    setManualOrder((current) => {
      const next = normalizeManualOrder(current, plannedItems);
      return sameOrder(current, next) ? current : next;
    });
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

  const plannedSectionRef = useRef<HTMLElement>(null);
  // Anything in the Planned section the dice can land on: games need a
  // cached card (for the slug) before they have a detail page to open.
  const randomCandidates = useMemo(
    () =>
      (grouped.get("planned") ?? []).flatMap((item): RandomPickCandidate[] => {
        const { href, state } = libraryItemLink(item, cards.get(item.id));
        return href ? [{ id: item.id, href, state }] : [];
      }),
    [grouped, cards],
  );
  const randomPick = useRandomPick(plannedSectionRef, randomCandidates);

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
  const compactShelf = useCompactShelf();
  const tileWidth = Math.round(MEDIA_LIBRARY_COVER_WIDTH * useShelfScale());

  return (
    <div
      className="library-wall min-h-full"
      data-library-theme={settings.libraryTheme}
    >
      <div className="mx-auto flex min-h-full w-full flex-col gap-10 px-5 py-8 md:px-8">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
              {heading}
            </h1>
            <span className="text-sm text-faint">
              {filtered.length} on the shelf
            </span>
          </div>
          {!authenticated && items.length > 0 && <GuestShelfNotice db={db} />}
        </header>
        {items.length === 0 && !authenticated ? (
          <GuestEmptyShelf db={db} />
        ) : items.length === 0 ? (
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
              <section
                key={g}
                ref={g === "planned" ? plannedSectionRef : undefined}
                className="flex flex-col"
              >
                <div className="flex items-center justify-between gap-4 mb-1">
                  <h2 className="font-display text-xl font-medium text-ink">
                    {SECTION_LABELS[g]}
                    <span className="ml-2 text-sm font-normal text-faint">
                      {sectionItems.length}
                    </span>
                  </h2>
                  <div className="flex items-center gap-1">
                    {g === "planned" && randomCandidates.length > 0 && (
                      <RandomPickButton
                        rolling={randomPick.rolling}
                        onRoll={randomPick.roll}
                      />
                    )}
                    {g === "planned" && (
                      <PlannedSortMenu
                        value={plannedSort}
                        onChange={setPlannedSort}
                      />
                    )}
                    {g !== "unreleased" && (
                      <Link
                        to={listHref(
                          g === "wishlist" ? "wishlisted" : groupListId(g),
                          activeType,
                        )}
                        aria-label={`See all ${SECTION_LABELS[g].toLowerCase()}`}
                        title="See all"
                        className="inline-flex rounded p-1.5 text-muted transition-colors hover:bg-well hover:text-accent"
                      >
                        <IconChevronRight className="size-5" aria-hidden />
                      </Link>
                    )}
                  </div>
                </div>
                {/* On phones In Progress is one sideways-scrolling shelf, bled
                    to the screen edges, so wide TV "next episode" cards and
                    a long in-progress list don't push the rest of the
                    library far down the page. */}
                <div
                  className={
                    g === "in-progress" && compactShelf
                      ? "shelf-rows shelf-strip -mx-5 flex items-start gap-x-3 scroll-px-5 px-5"
                      : "shelf-rows flex flex-wrap items-start justify-center gap-x-3 sm:gap-x-6"
                  }
                >
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
                      <div
                        className="roulette-card"
                        data-roulette-id={g === "planned" ? item.id : undefined}
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
                      </div>
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
                          width: `${tileWidth}px`,
                          aspectRatio: "2 / 3",
                        }}
                      >
                        <span className="font-display text-3xl font-semibold sm:text-4xl">
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
