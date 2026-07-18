import type { GameMetadata, LibraryItem, MetaStatus } from "@shelfie/shared";
import { META_STATUSES, STATUS_META_GROUP } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import IconPlus from "~icons/tabler/plus";
import type { AppOutletContext } from "../../App";
import { authFetch } from "../../auth";
import { gameImageUrl } from "../../images";
import { type GameCardDoc, upsertCards } from "../../db/gameCards";
import { GameCover } from "../games/GameCover";
import { LIBRARY_COVER_SCALE, selectPlatform } from "../games/platforms";

const META_LABELS: Record<MetaStatus, string> = {
  "in-progress": "In Progress",
  "planned": "Planned",
  "finished": "Finished",
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

export default function Library() {
  const { db } = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();
  const [items, setItems] = useState<RxDocument<LibraryItem>[]>([]);
  const [cards, setCards] = useState<Map<string, GameCardDoc>>(new Map());

  useEffect(() => {
    const sub = db.library_items.find().$.subscribe((found) => {
      setItems([...found]);
    });
    return () => sub.unsubscribe();
  }, [db]);

  useEffect(() => {
    const sub = db.game_metadata.find().$.subscribe((found) => {
      setCards(new Map(found.map((doc) => [doc.id, doc])));
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
            {grouped.get(g)!.map((item) => {
              const meta = cards.get(item.id);
              const cover = meta?.coverImageId
                ? gameImageUrl("t_cover_big", meta.coverImageId)
                : null;
              const platform = selectPlatform(
                item.platforms,
                meta?.platforms ?? [],
                meta?.platformReleaseDates ?? [],
              );
              const caption = cardCaption(item, meta);
              return (
                <div key={item.id} className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={!meta?.slug}
                    onClick={() => {
                      if (meta?.slug)
                        navigate(`/games/${encodeURIComponent(meta.slug)}`);
                    }}
                    className="rounded text-left disabled:cursor-default disabled:opacity-60"
                  >
                    <GameCover
                      coverUrl={cover}
                      platform={platform}
                      name={meta?.name ?? item.sourceId}
                      scale={LIBRARY_COVER_SCALE}
                    />
                  </button>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted font-bold">
                      {caption}
                    </span>
                    <button
                      type="button"
                      aria-label="Log activity"
                      className="text-xl leading-none text-muted hover:text-accent"
                    >
                      <IconPlus />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
