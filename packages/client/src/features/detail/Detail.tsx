import { ITEM_STATUSES } from "@shelfie/shared";
import type { GameMetadata, ItemStatus, LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useState } from "react";
import { authFetch } from "../../auth";
import type { ShelfieDatabase } from "../../db/database";

const STATUS_LABELS: Record<ItemStatus, string> = {
  wishlisted: "Wishlisted",
  backlogged: "Backlogged",
  playing: "Playing",
  played: "Played",
  beaten: "Beaten",
  completed: "Completed",
};

export function Detail({
  db,
  id,
  onBack,
}: {
  db: ShelfieDatabase;
  id: string;
  onBack: () => void;
}) {
  const [item, setItem] = useState<RxDocument<LibraryItem> | null | undefined>(
    undefined,
  );
  const [meta, setMeta] = useState<GameMetadata | null>(null);

  useEffect(() => {
    const sub = db.library_items.findOne(id).$.subscribe((doc) => {
      setItem(doc ?? null);
    });
    return () => sub.unsubscribe();
  }, [db, id]);

  const sourceId = item?.sourceId;
  useEffect(() => {
    if (!sourceId) return;
    let active = true;
    void authFetch(`/api/games?ids=${sourceId}`)
      .then((res) => (res.ok ? (res.json() as Promise<GameMetadata[]>) : []))
      .then((rows) => {
        if (active) setMeta(rows[0] ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [sourceId]);

  if (item === undefined) {
    return <div className="p-4 text-muted">Loading…</div>;
  }

  if (item === null) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-muted">
        <p>This item is no longer in your library.</p>
        <button
          type="button"
          onClick={onBack}
          className="text-accent underline"
        >
          Back to library
        </button>
      </div>
    );
  }

  const cover = meta?.coverImageId
    ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${meta.coverImageId}.jpg`
    : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-muted hover:text-ink"
      >
        ← Back
      </button>
      <div className="flex gap-4">
        <div className="h-56 w-40 shrink-0 overflow-hidden rounded bg-panel ring-1 ring-divider">
          {cover && (
            <img
              src={cover}
              alt={meta?.name ?? item.sourceId}
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-xl font-semibold text-ink">
            {meta?.name ?? item.sourceId}
          </h2>
          {meta?.firstReleaseDate && (
            <p className="text-sm text-muted">
              {new Date(meta.firstReleaseDate * 1000).getFullYear()}
            </p>
          )}
          {meta && meta.genres.length > 0 && (
            <p className="text-sm text-muted">{meta.genres.join(", ")}</p>
          )}
          {meta && meta.platforms.length > 0 && (
            <p className="text-sm text-muted">{meta.platforms.join(", ")}</p>
          )}
          {meta?.developer && (
            <p className="text-sm text-muted">{meta.developer}</p>
          )}
        </div>
      </div>
      {meta?.summary && <p className="text-sm text-ink">{meta.summary}</p>}
      <div className="flex flex-col gap-3 rounded border border-divider bg-panel p-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Status
          <select
            value={item.status}
            onChange={(e) => {
              void item.incrementalPatch({
                status: e.target.value as ItemStatus,
                updatedAt: Date.now(),
              });
            }}
            className="rounded bg-bg px-3 py-2 text-ink ring-1 ring-divider"
          >
            {ITEM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        {item.status === "playing" && (
          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Progress ({item.progress ?? 0}%)
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={item.progress ?? 0}
              onChange={(e) => {
                void item.incrementalPatch({
                  progress: Number(e.target.value),
                  updatedAt: Date.now(),
                });
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}
