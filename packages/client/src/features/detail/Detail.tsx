import type { GameDetail, LibraryItem, StoreName } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router";
import type { AppOutletContext } from "../../App";
import type { Route } from "./+types/Detail";
import { authFetch } from "../../auth";
import { upsertCards } from "../../db/gameCards";
import { GameCover } from "../games/GameCover";
import {
  DETAIL_COVER_SCALE,
  gameCoverTransitionName,
  selectPlatform,
} from "../games/platforms";
import { gameImageUrl } from "../../images";
import { StatusControl } from "../games/StatusControl";

const STORE_LABELS: Record<StoreName, string> = {
  official: "Official site",
  steam: "Steam",
  epic: "Epic",
  gog: "GOG",
  itch: "itch.io",
};

type MetaState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "loaded"; meta: GameDetail };

/** Minimal cover data passed via `<Link state>` from the library/search
 *  cards that navigate here, so the first paint (before the detail fetch
 *  resolves) already has a cover box on-screen — a view transition can only
 *  pair a `view-transition-name` across old/new snapshots if the named
 *  element is actually present in the DOM when each snapshot is taken. */
interface DetailLinkState {
  coverUrl: string | null;
  platform: string | null;
  name: string;
}

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
    // pushCount-based hasAppHistory() provided. `navigate(-1)`'s delta
    // overload takes no options, but react-router replays a POP navigation's
    // view transition automatically when the matching forward nav used one
    // (see `appliedViewTransitions` in its router), so the cover still morphs.
    if (location.key !== "default") navigate(-1);
    else navigate("/", { viewTransition: true });
  }

  if (metaState.status === "loading") {
    const linkState = location.state as DetailLinkState | null;
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
              coverUrl={linkState?.coverUrl ?? null}
              platform={linkState?.platform ?? null}
              name={linkState?.name ?? "Loading…"}
              scale={DETAIL_COVER_SCALE}
              viewTransitionName={gameCoverTransitionName(slug)}
            />
          </div>
          {linkState?.name && (
            <h2 className="text-xl font-semibold text-ink">{linkState.name}</h2>
          )}
        </div>
      </div>
    );
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
            viewTransitionName={gameCoverTransitionName(slug)}
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
      <StatusControl
        db={db}
        game={{
          igdbId: meta.igdbId,
          name: meta.name,
          platforms: meta.platforms,
        }}
        item={item}
      />
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
    </div>
  );
}
