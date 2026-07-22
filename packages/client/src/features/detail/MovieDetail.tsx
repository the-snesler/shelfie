import type { MovieDetail as MovieDetailDto } from "@shelfie/shared";
import { useLocation, useNavigate, useOutletContext } from "react-router";
import type { AppOutletContext } from "../../App";
import type { Route } from "./+types/MovieDetail";
import { upsertMovieCards } from "../../db/movieCards";
import { tmdbImageUrl } from "../../images";
import {
  MediaCover,
  MEDIA_DETAIL_COVER_WIDTH,
  mediaCoverTransitionName,
} from "../media/MediaCover";
import { releaseDateFromYear } from "../media/libraryActions";
import { formatRuntime } from "../media/duration";
import { StatusControl } from "../media/StatusControl";
import { useBackNavigation } from "./useBackNavigation";
import { useDetailFetch } from "./useDetailFetch";
import {
  Description,
  DetailBackdrop,
  DetailBodySkeleton,
  DetailCard,
  DetailHero,
  DetailPage,
  NotFound,
  RatingPills,
  TrailerChips,
} from "./DetailChrome";

export default function MovieDetail({ params }: Route.ComponentProps) {
  const { db } = useOutletContext<AppOutletContext>();
  const id = params.id;
  const navigate = useNavigate();
  const location = useLocation();
  const { metaState, item } = useDetailFetch<MovieDetailDto>({
    db,
    url: `/api/movies/by-id/${encodeURIComponent(id)}`,
    libraryItemId: (meta) => `movie:${meta.tmdbId}`,
    upsertCards: upsertMovieCards,
  });
  const handleBack = useBackNavigation();

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
        <DetailBodySkeleton />
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
          [meta.year, formatRuntime(meta.runtime), meta.certification]
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
              releaseDate: releaseDateFromYear(meta.year),
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
