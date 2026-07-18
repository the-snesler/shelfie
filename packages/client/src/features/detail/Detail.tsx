import {
  ITEM_STATUSES,
  LOG_FORMATS_BY_MEDIA,
  STATUS_META_GROUP,
  defaultLogFormat,
} from "@shelfie/shared";
import type {
  GameDetail,
  ItemStatus,
  LibraryItem,
  LogFormat,
  StoreName,
} from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router";
import IconX from "~icons/tabler/x";
import type { AppOutletContext } from "../../App";
import type { Route } from "./+types/Detail";
import { authFetch } from "../../auth";
import { upsertCards } from "../../db/gameCards";
import { GameCover } from "../games/GameCover";
import { DETAIL_COVER_SCALE, selectPlatform } from "../games/platforms";
import { gameImageUrl } from "../../images";
import { StarRating } from "./StarRating";

const STATUS_LABELS: Record<ItemStatus, string> = {
  wishlisted: "Wishlisted",
  backlogged: "Backlogged",
  playing: "Playing",
  played: "Played",
  beaten: "Beaten",
  completed: "Completed",
};

const STORE_LABELS: Record<StoreName, string> = {
  official: "Official site",
  steam: "Steam",
  epic: "Epic",
  gog: "GOG",
  itch: "itch.io",
};

/** Sentinel `<select>` value for a game with no library doc yet. */
const NOT_IN_LIBRARY = "__not_in_library__";

/** Sentinel `<select>` value that triggers removal from the library. */
const REMOVE_FROM_LIBRARY = "__remove_from_library__";

const COMPLETION_STATUSES: Record<ItemStatus, boolean> = {
  wishlisted: false,
  backlogged: false,
  playing: false,
  played: true,
  beaten: true,
  completed: true,
};

/** Local-time YYYY-MM-DD (avoids the UTC off-by-one of toISOString). */
function toLocalIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type MetaState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "loaded"; meta: GameDetail };

/** Whole hours + minutes, e.g. `64800 -> "18h"`, `81000 -> "22h 30m"`. */
function formatHltb(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function Detail({ params }: Route.ComponentProps) {
  const { db } = useOutletContext<AppOutletContext>();
  const slug = params.slug;
  const navigate = useNavigate();
  const location = useLocation();
  const [metaState, setMetaState] = useState<MetaState>({
    status: "loading",
  });
  const [item, setItem] = useState<RxDocument<LibraryItem> | null | undefined>(
    undefined,
  );
  const [datePrompt, setDatePrompt] = useState<{ date: string } | null>(null);

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
        const meta = (await res.json()) as GameDetail;
        setMetaState({ status: "loaded", meta });
        void upsertCards(db, [meta]);
      })
      .catch(() => {
        if (active) setMetaState({ status: "not-found" });
      });
    return () => {
      active = false;
    };
  }, [db, slug]);

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
    // location.key is "default" only for the initial history entry (deep link
    // / hard load), where going back would leave the app — same guard the old
    // pushCount-based hasAppHistory() provided.
    if (location.key !== "default") navigate(-1);
    else navigate("/");
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
    ? gameImageUrl("t_cover_big", meta.coverImageId)
    : null;
  const detailPlatform = selectPlatform(
    item?.platforms ?? [],
    meta.platforms,
    meta.platformReleaseDates,
  );
  const detailRows = [
    meta.developer && { label: "Developer", value: meta.developer },
    meta.publisher && { label: "Publisher", value: meta.publisher },
    meta.gameModes.length > 0 && {
      label: "Modes",
      value: meta.gameModes.join(" · "),
    },
    meta.themes.length > 0 && {
      label: "Themes",
      value: meta.themes.join(" · "),
    },
    meta.playerPerspectives.length > 0 && {
      label: "Perspectives",
      value: meta.playerPerspectives.join(" · "),
    },
    meta.platforms.length > 0 && {
      label: "Platforms",
      value: meta.platforms.join(" · "),
    },
  ].filter((row): row is { label: string; value: string } => Boolean(row));

  function handleStatusChange(value: ItemStatus) {
    if (item) {
      void item.incrementalPatch({ status: value, updatedAt: Date.now() });
    } else {
      const now = Date.now();
      const doc: LibraryItem = {
        id: `game:${meta.igdbId}`,
        mediaType: "game",
        sourceId: String(meta.igdbId),
        status: value,
        progressFormat: defaultLogFormat("game"),
        progressValue: null,
        platforms: [],
        rating: null,
        completedDates: [],
        notes: "",
        addedAt: now,
        updatedAt: now,
      };
      void db.library_items.insert(doc);
    }
    if (COMPLETION_STATUSES[value]) {
      setDatePrompt({ date: toLocalIsoDate(new Date()) });
    }
  }

  function togglePlatform(p: string) {
    if (!item) return;
    const has = item.platforms.includes(p);
    const platforms = has
      ? item.platforms.filter((x) => x !== p)
      : [...item.platforms, p];
    void item.incrementalPatch({ platforms, updatedAt: Date.now() });
  }

  function handleRemove() {
    if (!item) return;
    void item
      .incrementalPatch({ updatedAt: Date.now() })
      .then((doc) => doc.incrementalRemove());
  }

  async function addCompletionDate(date: string) {
    if (!date) return;
    const doc = await db.library_items.findOne(`game:${meta.igdbId}`).exec();
    setDatePrompt(null);
    if (!doc || doc.completedDates.includes(date)) return;
    await doc.incrementalPatch({
      completedDates: [...doc.completedDates, date],
      updatedAt: Date.now(),
    });
  }

  function removeCompletionDate(date: string) {
    if (!item) return;
    void item.incrementalPatch({
      completedDates: item.completedDates.filter((d) => d !== date),
      updatedAt: Date.now(),
    });
  }

  function handleRating(value: number | null) {
    if (!item) return;
    void item.incrementalPatch({ rating: value, updatedAt: Date.now() });
  }

  function handleFormatChange(format: LogFormat) {
    if (!item || item.progressFormat === format) return;
    // No cross-unit conversion (42% ≠ 42h) — reset value on switch.
    void item.incrementalPatch({
      progressFormat: format,
      progressValue: null,
      updatedAt: Date.now(),
    });
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
          {meta.publisher && (
            <p className="text-sm text-muted">{meta.publisher}</p>
          )}
        </div>
      </div>
      {(meta.aggregatedRating != null ||
        meta.rating != null ||
        meta.timeToBeat?.normally != null) && (
        <div className="flex flex-wrap gap-2">
          {meta.aggregatedRating != null && (
            <span className="rounded bg-bg px-2 py-1 text-xs ring-1 ring-divider">
              Critics {Math.round(meta.aggregatedRating)}
              {meta.aggregatedRatingCount > 0 &&
                ` (${meta.aggregatedRatingCount})`}
            </span>
          )}
          {meta.rating != null && (
            <span className="rounded bg-bg px-2 py-1 text-xs ring-1 ring-divider">
              IGDB {(meta.rating / 10).toFixed(1)}
            </span>
          )}
          {meta.timeToBeat?.normally != null && (
            <span className="rounded bg-bg px-2 py-1 text-xs ring-1 ring-divider">
              HLTB ~{formatHltb(meta.timeToBeat.normally)}
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col gap-3 rounded border border-divider bg-panel p-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Status
          <select
            value={item ? item.status : NOT_IN_LIBRARY}
            disabled={item === undefined}
            onChange={(e) => {
              if (e.target.value === REMOVE_FROM_LIBRARY) {
                handleRemove();
              } else {
                handleStatusChange(e.target.value as ItemStatus);
              }
            }}
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
            {item && (
              <option value={REMOVE_FROM_LIBRARY}>Remove from library</option>
            )}
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
        {item && STATUS_META_GROUP[item.status] !== "planned" && (
          <div className="flex flex-col gap-2">
            {LOG_FORMATS_BY_MEDIA.game.length > 1 && (
              <div className="flex gap-2">
                {LOG_FORMATS_BY_MEDIA.game.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => handleFormatChange(f)}
                    className={
                      item.progressFormat === f
                        ? "rounded bg-accent px-2 py-1 text-xs text-white"
                        : "rounded bg-bg px-2 py-1 text-xs text-ink ring-1 ring-divider"
                    }
                  >
                    {f === "hours" ? "Hours" : "Percent"}
                  </button>
                ))}
              </div>
            )}
            {item.progressFormat === "hours" ? (
              <label className="flex flex-col gap-1 text-sm font-medium text-muted">
                Hours played ({item.progressValue ?? 0}h)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={item.progressValue ?? 0}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    void item.incrementalPatch({
                      progressValue: Number.isFinite(n) && n >= 0 ? n : 0,
                      updatedAt: Date.now(),
                    });
                  }}
                  className="rounded bg-bg px-3 py-2 text-ink ring-1 ring-divider"
                />
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-sm font-medium text-muted">
                Progress ({item.progressValue ?? 0}%)
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={item.progressValue ?? 0}
                  onChange={(e) => {
                    void item.incrementalPatch({
                      progressValue: Number(e.target.value),
                      updatedAt: Date.now(),
                    });
                  }}
                />
              </label>
            )}
          </div>
        )}
        {item && (
          <div className="flex flex-col gap-1 text-sm font-medium text-muted">
            Rating
            <StarRating value={item.rating} onChange={handleRating} />
          </div>
        )}
        {item && item.completedDates.length > 0 && (
          <div className="flex flex-col gap-1 text-sm font-medium text-muted">
            Completed
            <div className="flex flex-wrap gap-2">
              {[...item.completedDates]
                .sort()
                .reverse()
                .map((date) => (
                  <button
                    key={date}
                    type="button"
                    onClick={() => removeCompletionDate(date)}
                    title="Click to remove"
                    className="group flex items-center gap-1 rounded bg-bg px-2 py-1 text-xs text-ink ring-1 ring-divider hover:ring-accent"
                  >
                    {new Date(`${date}T00:00:00`).toLocaleDateString(
                      undefined,
                      {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      },
                    )}
                    <IconX className="opacity-0 group-hover:opacity-100" />
                  </button>
                ))}
            </div>
          </div>
        )}
        {item && (
          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Notes
            <textarea
              key={item.id}
              defaultValue={item.notes}
              onBlur={(e) => {
                if (e.target.value !== item.notes) {
                  void item.incrementalPatch({
                    notes: e.target.value,
                    updatedAt: Date.now(),
                  });
                }
              }}
              rows={4}
              className="rounded bg-bg px-3 py-2 text-ink ring-1 ring-divider"
            />
          </label>
        )}
      </div>
      {meta.screenshotImageIds.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {meta.screenshotImageIds.map((id) => (
            <a
              key={id}
              target="_blank"
              rel="noreferrer"
              href={gameImageUrl("t_1080p", id)}
            >
              <img
                loading="lazy"
                src={gameImageUrl("t_screenshot_med", id)}
                className="h-24 w-auto rounded object-cover"
              />
            </a>
          ))}
        </div>
      )}
      {meta.videos.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {meta.videos.map((video) => (
            <li key={video.videoId}>
              <a
                target="_blank"
                rel="noreferrer"
                href={`https://www.youtube.com/watch?v=${video.videoId}`}
                className="text-accent underline"
              >
                {video.name ?? "Trailer"}
              </a>
            </li>
          ))}
        </ul>
      )}
      {meta.summary && <p className="text-sm text-ink">{meta.summary}</p>}
      {meta.storyline && <p className="text-sm text-muted">{meta.storyline}</p>}
      {(detailRows.length > 0 || meta.stores.length > 0) && (
        <div className="flex flex-col gap-2 rounded border border-divider bg-panel p-4 text-sm">
          {detailRows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <span className="text-muted">{row.label}</span>
              <span className="text-right text-ink">{row.value}</span>
            </div>
          ))}
          {meta.stores.length > 0 && (
            <div className="flex justify-between gap-4">
              <span className="text-muted">Get it</span>
              <span className="flex flex-wrap justify-end gap-2">
                {meta.stores.map((store) => (
                  <a
                    key={store.store}
                    target="_blank"
                    rel="noreferrer"
                    href={store.url}
                    className="text-accent underline"
                  >
                    {STORE_LABELS[store.store]}
                  </a>
                ))}
              </span>
            </div>
          )}
        </div>
      )}
      {datePrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDatePrompt(null)}
        >
          <div
            className="flex flex-col gap-3 rounded border border-divider bg-panel p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-medium text-ink">
              When did you finish it?
            </p>
            <input
              type="date"
              value={datePrompt.date}
              onChange={(e) => setDatePrompt({ date: e.target.value })}
              className="rounded bg-bg px-3 py-2 text-ink ring-1 ring-divider"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDatePrompt(null)}
                className="rounded px-3 py-1 text-sm text-muted hover:text-ink"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => void addCompletionDate(datePrompt.date)}
                className="rounded bg-accent px-3 py-1 text-sm text-white"
              >
                Add date
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
