import type {
  LibraryItem,
  TvDetail as TvDetailDto,
  TvSeason,
} from "@shelfie/shared";
import { episodeKey } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router";
import type { AppOutletContext } from "../../App";
import type { Route } from "./+types/TvDetail";
import { authFetch } from "../../auth";
import { upsertTvCards } from "../../db/tvCards";
import { tmdbImageUrl } from "../../images";
import { newLibraryItem } from "../media/libraryActions";
import {
  MediaCover,
  MEDIA_DETAIL_COVER_WIDTH,
  mediaCoverTransitionName,
} from "../media/MediaCover";
import { StatusControl } from "../media/StatusControl";

type MetaState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; meta: TvDetailDto };

/** Ascending by seasonNumber, with Specials (0) pushed to the end. */
function orderedSeasons(seasons: TvSeason[]): TvSeason[] {
  return [...seasons].sort((a, b) => {
    if (a.seasonNumber === 0) return 1;
    if (b.seasonNumber === 0) return -1;
    return a.seasonNumber - b.seasonNumber;
  });
}

export default function TvDetail({ params }: Route.ComponentProps) {
  const { db } = useOutletContext<AppOutletContext>();
  const id = params.id;
  const navigate = useNavigate();
  const location = useLocation();
  const [metaState, setMetaState] = useState<MetaState>({ status: "loading" });
  const [item, setItem] = useState<RxDocument<LibraryItem> | null | undefined>(
    undefined,
  );

  useEffect(() => {
    setMetaState({ status: "loading" });
    let active = true;
    void authFetch(`/api/tv/by-id/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (!active) return;
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const meta = (await res.json()) as TvDetailDto;
        setMetaState({ status: "loaded", meta });
        void upsertTvCards(db, [meta]);
      })
      .catch(() => {
        if (active) setMetaState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [db, id]);

  const tmdbId = metaState.status === "loaded" ? metaState.meta.tmdbId : null;
  useEffect(() => {
    if (tmdbId === null) {
      setItem(undefined);
      return;
    }
    const sub = db.library_items.findOne(`tv:${tmdbId}`).$.subscribe((doc) => {
      setItem(doc ?? null);
    });
    return () => sub.unsubscribe();
  }, [db, tmdbId]);

  function handleBack() {
    if (location.key !== "default") navigate(-1);
    else navigate("/", { viewTransition: true });
  }

  /** Persists a full replacement `watchedEpisodes` list — patches the
   *  existing item, or (first toggle on an unowned show) creates one as
   *  `active`, same lazy-add behavior as StatusControl's default click. */
  async function applyWatched(next: string[]) {
    if (metaState.status !== "loaded") return;
    const meta = metaState.meta;
    if (item) {
      await item.incrementalPatch({
        watchedEpisodes: next,
        updatedAt: Date.now(),
      });
    } else {
      const base = newLibraryItem(
        {
          mediaType: "tv",
          sourceId: String(meta.tmdbId),
          name: meta.name,
          platforms: [],
        },
        "active",
      );
      await db.library_items.insert({ ...base, watchedEpisodes: next });
    }
  }

  function toggleEpisode(season: number, episode: number) {
    const key = episodeKey(season, episode);
    const current = item?.watchedEpisodes ?? [];
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key];
    void applyWatched(next);
  }

  function toggleSeason(season: TvSeason) {
    const current = item?.watchedEpisodes ?? [];
    const keys = season.episodes.map((ep) =>
      episodeKey(season.seasonNumber, ep.episodeNumber),
    );
    const allWatched =
      keys.length > 0 && keys.every((k) => current.includes(k));
    const next = allWatched
      ? current.filter((k) => !keys.includes(k))
      : [...current, ...keys.filter((k) => !current.includes(k))];
    void applyWatched(next);
  }

  if (metaState.status === "loading") {
    const linkState = location.state as {
      coverUrl?: string | null;
      name?: string;
    } | null;
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
            <MediaCover
              coverUrl={linkState?.coverUrl ?? null}
              name={linkState?.name ?? "Loading…"}
              width={MEDIA_DETAIL_COVER_WIDTH}
              viewTransitionName={mediaCoverTransitionName("tv", id)}
            />
          </div>
          {linkState?.name && (
            <h2 className="text-xl font-semibold text-ink">{linkState.name}</h2>
          )}
        </div>
      </div>
    );
  }

  if (metaState.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-muted">
        <p>Show not found.</p>
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
  const poster = meta.posterPath ? tmdbImageUrl(meta.posterPath, "w500") : null;
  const backdrop = meta.backdropPath
    ? tmdbImageUrl(meta.backdropPath, "w1280")
    : null;

  const watchedEpisodes = item?.watchedEpisodes ?? [];
  const watchedCount = watchedEpisodes.filter(
    (k) => !k.startsWith("s0e"),
  ).length;
  const percent =
    meta.numberOfEpisodes > 0
      ? Math.round((watchedCount / meta.numberOfEpisodes) * 100)
      : 0;
  const seasons = orderedSeasons(meta.seasons);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <button
        type="button"
        onClick={handleBack}
        className="self-start text-sm text-muted hover:text-ink"
      >
        ← Back
      </button>
      {backdrop && (
        <img
          loading="lazy"
          src={backdrop}
          className="aspect-video w-full rounded object-cover"
        />
      )}
      <div className="flex gap-4">
        <div className="shrink-0">
          <MediaCover
            coverUrl={poster}
            name={meta.name}
            width={MEDIA_DETAIL_COVER_WIDTH}
            viewTransitionName={mediaCoverTransitionName("tv", id)}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-xl font-semibold text-ink">{meta.name}</h2>
          {meta.tagline && (
            <p className="text-sm italic text-muted">{meta.tagline}</p>
          )}
          {meta.firstAirYear != null && (
            <p className="text-sm text-muted">{meta.firstAirYear}</p>
          )}
          {meta.genres.length > 0 && (
            <p className="text-sm text-muted">{meta.genres.join(", ")}</p>
          )}
          {meta.networks.length > 0 && (
            <p className="text-sm text-muted">{meta.networks.join(", ")}</p>
          )}
          {meta.createdBy.length > 0 && (
            <p className="text-sm text-muted">{meta.createdBy.join(", ")}</p>
          )}
          {meta.status && <p className="text-sm text-muted">{meta.status}</p>}
          {meta.certification && (
            <p className="text-sm text-muted">{meta.certification}</p>
          )}
        </div>
      </div>
      {(meta.voteAverage != null || meta.voteCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {meta.voteAverage != null && (
            <span className="rounded bg-bg px-2 py-1 text-xs ring-1 ring-divider">
              TMDB {meta.voteAverage.toFixed(1)}
              {meta.voteCount > 0 && ` (${meta.voteCount})`}
            </span>
          )}
        </div>
      )}
      <StatusControl
        db={db}
        target={{
          mediaType: "tv",
          sourceId: String(meta.tmdbId),
          name: meta.name,
          platforms: [],
        }}
        item={item}
      />
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
      {meta.cast.length > 0 && (
        <div className="flex flex-col gap-2 rounded border border-divider bg-panel p-4 text-sm">
          <span className="text-muted">Cast</span>
          <p className="text-ink">
            {meta.cast
              .map((c) =>
                c.character ? `${c.name} as ${c.character}` : c.name,
              )
              .join(" · ")}
          </p>
        </div>
      )}
      {meta.numberOfEpisodes > 0 && (
        <div className="flex flex-col gap-1">
          <div className="h-2 w-full overflow-hidden rounded bg-bg ring-1 ring-divider">
            <div
              className="h-full bg-accent"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-muted">
            {watchedCount}/{meta.numberOfEpisodes} episodes · {percent}%
          </p>
        </div>
      )}
      {seasons.length > 0 && (
        <div className="flex flex-col gap-4">
          {seasons.map((season) => {
            const keys = season.episodes.map((ep) =>
              episodeKey(season.seasonNumber, ep.episodeNumber),
            );
            const seasonWatched = keys.filter((k) =>
              watchedEpisodes.includes(k),
            ).length;
            const allWatched = keys.length > 0 && seasonWatched === keys.length;
            return (
              <div
                key={season.seasonNumber}
                className="flex flex-col gap-2 rounded border border-divider p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">
                    {season.seasonNumber === 0
                      ? "Specials"
                      : season.name || `Season ${season.seasonNumber}`}
                    <span className="ml-2 text-xs font-normal text-muted">
                      {seasonWatched}/{keys.length}
                    </span>
                  </h3>
                  <button
                    type="button"
                    disabled={item === undefined || keys.length === 0}
                    onClick={() => toggleSeason(season)}
                    className="rounded bg-bg px-2 py-1 text-xs ring-1 ring-divider hover:bg-panel disabled:opacity-50"
                  >
                    {allWatched
                      ? "Mark season unwatched"
                      : "Mark season watched"}
                  </button>
                </div>
                <ul className="flex flex-col gap-1">
                  {season.episodes.map((ep) => {
                    const key = episodeKey(
                      season.seasonNumber,
                      ep.episodeNumber,
                    );
                    const watched = watchedEpisodes.includes(key);
                    return (
                      <li key={key} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={watched}
                          disabled={item === undefined}
                          onChange={() =>
                            toggleEpisode(season.seasonNumber, ep.episodeNumber)
                          }
                        />
                        <span className="text-muted">
                          S{season.seasonNumber}E{ep.episodeNumber}
                        </span>
                        <span className="text-ink">{ep.name}</span>
                        {ep.airDate && (
                          <span className="ml-auto text-xs text-muted">
                            {ep.airDate}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
