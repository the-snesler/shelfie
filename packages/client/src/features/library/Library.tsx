import type { GameMetadata, ItemStatus, LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useMemo, useState } from "react";
import { authFetch } from "../../auth";
import { gameImageUrl } from "../../images";
import type { ShelfieDatabase } from "../../db/database";
import { type GameCardDoc, upsertCards } from "../../db/gameCards";
import { navigate } from "../../router";
import { GameCover } from "../games/GameCover";
import { LIBRARY_COVER_SCALE, selectPlatform } from "../games/platforms";

const STATUS_LABELS: Record<ItemStatus, string> = {
  wishlisted: "Wishlisted",
  backlogged: "Backlogged",
  playing: "Playing",
  played: "Played",
  beaten: "Beaten",
  completed: "Completed",
};

export function Library({ db }: { db: ShelfieDatabase }) {
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

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
        <p className="text-lg font-medium text-ink">Your library is empty</p>
        <p className="text-sm">Search for a game to add your first one.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap justify-center items-baseline gap-8 p-4">
      {items.map((item) => {
        const meta = cards.get(item.id);
        const cover = meta?.coverImageId
          ? gameImageUrl("t_cover_big", meta.coverImageId)
          : null;
        const platform = selectPlatform(
          item.platforms,
          meta?.platforms ?? [],
          meta?.platformReleaseDates ?? [],
        );
        return (
          <button
            key={item.id}
            type="button"
            disabled={!meta?.slug}
            onClick={() => {
              if (meta?.slug)
                navigate(`/games/${encodeURIComponent(meta.slug)}`);
            }}
            className="flex flex-col items-center gap-2 rounded text-left disabled:cursor-default disabled:opacity-60"
          >
            <GameCover
              coverUrl={cover}
              platform={platform}
              name={meta?.name ?? item.sourceId}
              scale={LIBRARY_COVER_SCALE}
            >
              <span className="absolute bottom-1 left-1 rounded bg-ink/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {STATUS_LABELS[item.status]}
              </span>
            </GameCover>
          </button>
        );
      })}
    </div>
  );
}
