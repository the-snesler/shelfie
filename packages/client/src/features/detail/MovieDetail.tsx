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
import {
  Description,
  DetailBackdrop,
  DetailCard,
  DetailHero,
  DetailPage,
  NotFound,
  RatingPills,
  TrailerChips,
} from "./DetailChrome";

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
      <DetailPage onBack={handleBack}>
        <DetailBackdrop src={null} />
        <DetailHero
          overlap
          name={linkState?.name ?? null}
          cover={
            <MediaCover
              coverUrl={linkState?.coverUrl ?? null}
              name={linkState?.name ?? "Loading…"}
              width={MEDIA_DETAIL_COVER_WIDTH}
              viewTransitionName={mediaCoverTransitionName("movie", id)}
            />
          }
        />
      </DetailPage>
    );
  }

  if (metaState.status === "error") {
    return <NotFound message="Movie not found" onBack={() => navigate("/")} />;
  }

  const meta = metaState.meta;
  const poster = meta.posterPath ? tmdbImageUrl(meta.posterPath, "w500") : null;
  const backdrop = meta.backdropPath
    ? tmdbImageUrl(meta.backdropPath, "w1280")
    : null;

  return (
    <DetailPage onBack={handleBack}>
      <DetailBackdrop src={backdrop} />
      <DetailHero
        overlap
        name={meta.name}
        tagline={meta.tagline}
        lines={[
          [
            meta.year,
            meta.runtime != null && meta.runtime > 0 && `${meta.runtime} min`,
            meta.certification,
          ]
            .filter(Boolean)
            .join(" · "),
          meta.genres.length > 0 && meta.genres.join(", "),
          meta.director,
        ]}
        cover={
          <MediaCover
            coverUrl={poster}
            name={meta.name}
            width={MEDIA_DETAIL_COVER_WIDTH}
            viewTransitionName={mediaCoverTransitionName("movie", id)}
          />
        }
      >
        <div className="mt-2 flex flex-col items-start gap-3">
          <RatingPills
            pills={[
              meta.voteAverage != null &&
                `TMDB ${meta.voteAverage.toFixed(1)}${
                  meta.voteCount > 0 ? ` (${meta.voteCount})` : ""
                }`,
            ]}
          />
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
        </div>
      </DetailHero>
      {meta.summary && <Description>{meta.summary}</Description>}
      <TrailerChips videos={meta.videos} />
      {meta.cast.length > 0 && (
        <DetailCard>
          <span className="font-display text-base font-medium text-ink">
            Cast
          </span>
          <p className="leading-relaxed text-ink">
            {meta.cast
              .map((c) =>
                c.character ? `${c.name} as ${c.character}` : c.name,
              )
              .join(" · ")}
          </p>
        </DetailCard>
      )}
    </DetailPage>
  );
}
