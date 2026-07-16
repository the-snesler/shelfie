import { ITEM_STATUSES } from "@shelfie/shared";
import type { GameMetadata, ItemStatus, LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useState } from "react";
import { authFetch } from "../../auth";
import type { ShelfieDatabase } from "../../db/database";
import { hasAppHistory, navigate } from "../../router";
import { GameCover } from "../games/GameCover";
import { DETAIL_COVER_SCALE, selectPlatform } from "../games/platforms";

const STATUS_LABELS: Record<ItemStatus, string> = {
  wishlisted: "Wishlisted",
  backlogged: "Backlogged",
  playing: "Playing",
  played: "Played",
  beaten: "Beaten",
  completed: "Completed",
};

/** Sentinel `<select>` value for a game with no library doc yet. */
const NOT_IN_LIBRARY = "__not_in_library__";

type MetaState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "loaded"; meta: GameMetadata };

export function Detail({ db, slug }: { db: ShelfieDatabase; slug: string }) {
  const [metaState, setMetaState] = useState<MetaState>({
    status: "loading",
  });
  const [item, setItem] = useState<RxDocument<LibraryItem> | null | undefined>(
    undefined,
  );

  useEffect(() => {
    setMetaState({ status: "loading" });
    let active = true;
    void authFetch(`/api/games/by-slug/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (!active) return;
        if (res.status === 404) {
          setMetaState({ status: "not-found" });
          return;
        }
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const meta = (await res.json()) as GameMetadata;
        setMetaState({ status: "loaded", meta });
      })
      .catch(() => {
        if (active) setMetaState({ status: "not-found" });
      });
    return () => {
      active = false;
    };
  }, [slug]);

  const igdbId = metaState.status === "loaded" ? metaState.meta.igdbId : null;
  useEffect(() => {
    if (igdbId === null) {
      setItem(undefined);
      return;
    }
    const sub = db.library_items
      .findOne(`game:${igdbId}`)
      .$.subscribe((doc) => {
        setItem(doc ?? null);
      });
    return () => sub.unsubscribe();
  }, [db, igdbId]);

  function handleBack() {
    if (hasAppHistory()) {
      window.history.back();
    } else {
      navigate("/");
    }
  }

  if (metaState.status === "loading") {
    return <div className="p-4 text-muted">Loading…</div>;
  }

  if (metaState.status === "not-found") {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-muted">
        <p>Game not found.</p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="text-accent underline"
        >
          Back to library
        </button>
      </div>
    );
  }

  const meta = metaState.meta;
  const cover = meta.coverImageId
    ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${meta.coverImageId}.jpg`
    : null;
  const detailPlatform = selectPlatform(
    item?.platforms ?? [],
    meta.platforms,
    meta.platformReleaseDates,
  );

  function handleStatusChange(value: ItemStatus) {
    if (item) {
      void item.incrementalPatch({ status: value, updatedAt: Date.now() });
      return;
    }
    const now = Date.now();
    const doc: LibraryItem = {
      id: `game:${meta.igdbId}`,
      mediaType: "game",
      sourceId: String(meta.igdbId),
      status: value,
      progress: null,
      platforms: [],
      addedAt: now,
      updatedAt: now,
    };
    void db.library_items.insert(doc);
  }

  function togglePlatform(p: string) {
    if (!item) return;
    const has = item.platforms.includes(p);
    const platforms = has
      ? item.platforms.filter((x) => x !== p)
      : [...item.platforms, p];
    void item.incrementalPatch({ platforms, updatedAt: Date.now() });
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <button
        type="button"
        onClick={handleBack}
        className="self-start text-sm text-muted hover:text-ink"
      >
        ← Back
      </button>
      <div className="flex gap-4">
        <div className="shrink-0">
          <GameCover
            coverUrl={cover}
            platform={detailPlatform}
            name={meta.name}
            scale={DETAIL_COVER_SCALE}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-xl font-semibold text-ink">{meta.name}</h2>
          {meta.firstReleaseDate && (
            <p className="text-sm text-muted">
              {new Date(meta.firstReleaseDate * 1000).getFullYear()}
            </p>
          )}
          {meta.genres.length > 0 && (
            <p className="text-sm text-muted">{meta.genres.join(", ")}</p>
          )}
          {meta.platforms.length > 0 && (
            <p className="text-sm text-muted">{meta.platforms.join(", ")}</p>
          )}
          {meta.developer && (
            <p className="text-sm text-muted">{meta.developer}</p>
          )}
        </div>
      </div>
      {meta.summary && <p className="text-sm text-ink">{meta.summary}</p>}
      <div className="flex flex-col gap-3 rounded border border-divider bg-panel p-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Status
          <select
            value={item ? item.status : NOT_IN_LIBRARY}
            disabled={item === undefined}
            onChange={(e) => handleStatusChange(e.target.value as ItemStatus)}
            className="rounded bg-bg px-3 py-2 text-ink ring-1 ring-divider"
          >
            <option value={NOT_IN_LIBRARY} disabled>
              Not in your library
            </option>
            {ITEM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        {item && meta.platforms.length > 0 && (
          <fieldset className="flex flex-col gap-1 text-sm font-medium text-muted">
            <legend>Platform</legend>
            <div className="flex flex-wrap gap-2">
              {meta.platforms.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={
                    item.platforms.includes(p)
                      ? "rounded bg-accent px-2 py-1 text-xs text-white"
                      : "rounded bg-bg px-2 py-1 text-xs text-ink ring-1 ring-divider"
                  }
                >
                  {p}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {item && item.status === "playing" && (
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
