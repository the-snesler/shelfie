import type { GameMetadata, LibraryItem, MetaStatus } from "@shelfie/shared";
import { META_STATUSES, STATUS_META_GROUP } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext, useViewTransitionState } from "react-router";
import IconPlus from "~icons/tabler/plus";
import type { AppOutletContext } from "../../App";
import { authFetch } from "../../auth";
import { gameImageUrl } from "../../images";
import { type GameCardDoc, upsertCards } from "../../db/gameCards";
import { LogPopover } from "../games/LogPopover";
import { useLogPopover } from "../games/useLogPopover";
import type { ShelfieDatabase } from "../../db/database";
import { GameCover } from "../games/GameCover";
import {
  gameCoverTransitionName,
  LIBRARY_COVER_SCALE,
  selectPlatform,
} from "../games/platforms";

const META_LABELS: Record<MetaStatus, string> = {
  "in-progress": "In Progress",
  planned: "Planned",
  finished: "Finished",
};

/** Whole hours from IGDB seconds, e.g. 79200 -> 22. */
function toHours(seconds: number): number {
  return Math.round(seconds / 3600);
}

/** Left-aligned caption beneath a card. null -> render no text (footer keeps
 *  the + button and its width). normally = IGDB "normally" seconds. */
function cardCaption(
  item: LibraryItem,
  meta: GameCardDoc | undefined,
): string | null {
  switch (STATUS_META_GROUP[item.status]) {
    case "in-progress": {
      return formatProgress(item, meta);
    }
    case "planned": {
      const expected = meta?.timeToBeat?.normally ?? null;
      return expected != null ? `~${toHours(expected)}h` : null;
    }
    case "finished": {
      return `${item.progressValue ?? 0}${formatProgressSuffix(item)}`;
    }
  }
}

function formatProgressSuffix(item: LibraryItem): string {
  if (item.progressFormat === "hours") return "h";
  return "%";
}

function formatProgress(
  item: LibraryItem,
  meta: GameCardDoc | undefined,
): string | null {
  const expected = meta?.timeToBeat?.normally ?? null;
  if (expected == null)
    return `${item.progressValue ?? 0}${formatProgressSuffix(item)}`;

  let pct: number;
  if (item.progressFormat === "hours") {
    const h = item.progressValue ?? 0;
    if (h >= toHours(expected)) return `${h}h`;
    pct = (h / toHours(expected)) * 100;
  } else {
    pct = item.progressValue ?? 0;
    if (pct >= 100) return `${pct}%`;
  }

  pct = Math.round(pct);
  pct = Math.min(Math.max(pct, 0), 100);
  const left = toHours(expected * (1 - pct / 100));
  return pct > 0 ? `${pct}% · ${left}h left` : `~${left}h left`;
}

/** One library grid cell: cover (linked to detail, view-transitioning) +
 *  caption + log-activity button. Its own component so `useViewTransitionState`
 *  gets a stable hook call per item rather than inside a `.map()` callback. */
function LibraryItemCard({
  db,
  item,
  meta,
  caption,
}: {
  db: ShelfieDatabase;
  item: RxDocument<LibraryItem>;
  meta: GameCardDoc | undefined;
  caption: string | null;
}) {
  const popover = useLogPopover();
  const cover = meta?.coverImageId
    ? gameImageUrl("t_cover_big", meta.coverImageId)
    : null;
  const platform = selectPlatform(
    item.platforms,
    meta?.platforms ?? [],
    meta?.platformReleaseDates ?? [],
  );
  const href = meta?.slug ? `/games/${encodeURIComponent(meta.slug)}` : null;
  const isTransitioning = useViewTransitionState(href ?? "/__no_transition__");
  const gameCover = (
    <GameCover
      coverUrl={cover}
      platform={platform}
      name={meta?.name ?? item.sourceId}
      scale={LIBRARY_COVER_SCALE}
      viewTransitionName={
        meta?.slug && isTransitioning
          ? gameCoverTransitionName(meta.slug)
          : undefined
      }
    />
  );

  return (
    <div className="flex flex-col gap-2">
      {href ? (
        <Link
          to={href}
          viewTransition
          state={{
            coverUrl: cover,
            platform,
            name: meta?.name ?? item.sourceId,
          }}
          className="rounded text-left"
        >
          {gameCover}
        </Link>
      ) : (
        <div className="cursor-default rounded text-left opacity-60">
          {gameCover}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted font-bold">{caption}</span>
        <button
          type="button"
          ref={popover.refs.setReference}
          {...popover.getReferenceProps()}
          aria-label="Log activity"
          onClick={() => popover.setOpen(true)}
          className="text-xl leading-none text-muted hover:text-accent"
        >
          <IconPlus />
        </button>
      </div>
      <LogPopover
        popover={popover}
        db={db}
        game={{
          igdbId: meta?.igdbId ?? Number(item.sourceId),
          name: meta?.name ?? item.sourceId,
          platforms: meta?.platforms ?? [],
        }}
        item={item}
      />
    </div>
  );
}

/** Last-known library snapshot, kept outside React state so a remount (e.g.
 *  navigating away to a game's detail page and back) can render the grid on
 *  its very first paint instead of flashing empty while RxDB's subscription
 *  reconnects — required for the view transition back to Library to find a
 *  cover box to morph into, since the browser only pairs elements present
 *  when it snapshots the new DOM, not whatever arrives a tick later. */
let cachedItems: RxDocument<LibraryItem>[] = [];
let cachedCards: Map<string, GameCardDoc> = new Map();

export default function Library() {
  const { db } = useOutletContext<AppOutletContext>();
  const [items, setItems] = useState<RxDocument<LibraryItem>[]>(cachedItems);
  const [cards, setCards] = useState<Map<string, GameCardDoc>>(cachedCards);

  useEffect(() => {
    const sub = db.library_items.find().$.subscribe((found) => {
      cachedItems = [...found];
      setItems(cachedItems);
    });
    return () => sub.unsubscribe();
  }, [db]);

  useEffect(() => {
    const sub = db.game_metadata.find().$.subscribe((found) => {
      cachedCards = new Map(found.map((doc) => [doc.id, doc]));
      setCards(cachedCards);
    });
    return () => sub.unsubscribe();
  }, [db]);

  const sourceIdKey = useMemo(
    () => [...new Set(items.map((item) => item.sourceId))].sort().join(","),
    [items],
  );

  useEffect(() => {
    if (!sourceIdKey) return;
    void authFetch(`/api/games?ids=${sourceIdKey}`)
      .then((res) => (res.ok ? (res.json() as Promise<GameMetadata[]>) : []))
      .then((rows) => upsertCards(db, rows))
      .catch(() => {});
  }, [db, sourceIdKey]);

  const grouped = useMemo(() => {
    const map = new Map<MetaStatus, RxDocument<LibraryItem>[]>();
    for (const item of items) {
      const g = STATUS_META_GROUP[item.status];
      const arr = map.get(g);
      if (arr) arr.push(item);
      else map.set(g, [item]);
    }
    return map;
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
        <p className="text-lg font-medium text-ink">Your library is empty</p>
        <p className="text-sm">Search for a game to add your first one.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 p-4 bg-zinc-50">
      {META_STATUSES.filter((g) => grouped.get(g)?.length).map((g) => (
        <section key={g} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">{META_LABELS[g]}</h2>
          <div className="flex flex-wrap items-end gap-4">
            {grouped.get(g)!.map((item) => (
              <LibraryItemCard
                key={item.id}
                db={db}
                item={item}
                meta={cards.get(item.id)}
                caption={cardCaption(item, cards.get(item.id))}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
