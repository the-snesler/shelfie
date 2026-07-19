import type {
  LibraryItem,
  MovieDetail as MovieDetailDto,
} from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router";
import type { AppOutletContext } from "../../App";
import type { Route } from "./+types/MovieDetail";
import { authFetch } from "../../auth";
import { upsertMovieCards } from "../../db/movieCards";
import { tmdbImageUrl } from "../../images";
import {
  MediaCover,
  MEDIA_DETAIL_COVER_WIDTH,
  mediaCoverTransitionName,
} from "../media/MediaCover";
import { StatusControl } from "../media/StatusControl";

type MetaState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; meta: MovieDetailDto };

export default function MovieDetail({ params }: Route.ComponentProps) {
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
    void authFetch(`/api/movies/by-id/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (!active) return;
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const meta = (await res.json()) as MovieDetailDto;
        setMetaState({ status: "loaded", meta });
        void upsertMovieCards(db, [meta]);
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
    const sub = db.library_items
      .findOne(`movie:${tmdbId}`)
      .$.subscribe((doc) => {
        setItem(doc ?? null);
      });
    return () => sub.unsubscribe();
  }, [db, tmdbId]);

  function handleBack() {
    if (location.key !== "default") navigate(-1);
    else navigate("/", { viewTransition: true });
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
              viewTransitionName={mediaCoverTransitionName("movie", id)}
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
        <p>Movie not found.</p>
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
            viewTransitionName={mediaCoverTransitionName("movie", id)}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-xl font-semibold text-ink">{meta.name}</h2>
          {meta.tagline && (
            <p className="text-sm italic text-muted">{meta.tagline}</p>
          )}
          {meta.year != null && (
            <p className="text-sm text-muted">{meta.year}</p>
          )}
          {meta.runtime != null && meta.runtime > 0 && (
            <p className="text-sm text-muted">{meta.runtime} min</p>
          )}
          {meta.genres.length > 0 && (
            <p className="text-sm text-muted">{meta.genres.join(", ")}</p>
          )}
          {meta.director && (
            <p className="text-sm text-muted">{meta.director}</p>
          )}
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
          mediaType: "movie",
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
    </div>
  );
}
