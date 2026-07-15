import type { GameMetadata, ItemStatus, LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useMemo, useState } from "react";
import { authFetch } from "../../auth";
import type { ShelfieDatabase } from "../../db/database";
import { navigate } from "../../router";

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
  const [metadata, setMetadata] = useState<Map<string, GameMetadata>>(
    new Map(),
  );

  useEffect(() => {
    const sub = db.library_items.find().$.subscribe((found) => {
      setItems([...found]);
    });
    return () => sub.unsubscribe();
  }, [db]);

  const sourceIdKey = useMemo(
    () => [...new Set(items.map((item) => item.sourceId))].sort().join(","),
    [items],
  );

  useEffect(() => {
    if (!sourceIdKey) {
      setMetadata(new Map());
      return;
    }
    let active = true;
    void authFetch(`/api/games?ids=${sourceIdKey}`)
      .then((res) => (res.ok ? (res.json() as Promise<GameMetadata[]>) : []))
      .then((rows) => {
        if (!active) return;
        setMetadata(new Map(rows.map((row) => [String(row.igdbId), row])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [sourceIdKey]);

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
        <p className="text-lg font-medium text-ink">Your library is empty</p>
        <p className="text-sm">Search for a game to add your first one.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {items.map((item) => {
        const meta = metadata.get(item.sourceId);
        const cover = meta?.coverImageId
          ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${meta.coverImageId}.jpg`
          : null;
        return (
          <button
            key={item.id}
            type="button"
            disabled={!meta?.slug}
            onClick={() => {
              if (meta?.slug)
                navigate(`/games/${encodeURIComponent(meta.slug)}`);
            }}
            className="flex flex-col gap-2 rounded text-left disabled:cursor-default disabled:opacity-60"
          >
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded bg-panel ring-1 ring-divider">
              {cover ? (
                <img
                  src={cover}
                  alt={meta?.name ?? item.sourceId}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted">
                  No cover
                </div>
              )}
              <span className="absolute bottom-1 left-1 rounded bg-ink/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {STATUS_LABELS[item.status]}
              </span>
            </div>
            <span className="line-clamp-2 text-sm font-medium text-ink">
              {meta?.name ?? item.sourceId}
            </span>
          </button>
        );
      })}
    </div>
  );
}
