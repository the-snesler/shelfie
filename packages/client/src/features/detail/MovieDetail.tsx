import type { MovieDetail as MovieDetailDto } from "@shelfie/shared";
import { useOutletContext } from "react-router";
import type { AppOutletContext } from "../../App";
import type { Route } from "./+types/MovieDetail";
import { upsertMovieCards } from "../../db/movieCards";
import { tmdbImageUrl } from "../../images";
import {
  MediaCover,
  MEDIA_DETAIL_COVER_WIDTH,
  mediaCoverTransitionName,
} from "../media/MediaCover";
import { yearOf } from "../media/libraryActions";
import { formatRuntime } from "../media/duration";
import { StatusControl } from "../media/StatusControl";
import { useDetailFetch } from "./useDetailFetch";
import { DetailScreen } from "./DetailScreen";
import { Description, DetailCard, TrailerChips } from "./DetailChrome";

export default function MovieDetail({ params }: Route.ComponentProps) {
  const { db } = useOutletContext<AppOutletContext>();
  const id = params.id;
  const { metaState, item } = useDetailFetch<MovieDetailDto>({
    db,
    url: `/api/movies/by-id/${encodeURIComponent(id)}`,
    libraryItemId: (meta) => `movie:${meta.tmdbId}`,
    upsertCards: upsertMovieCards,
  });

  return (
    <DetailScreen
      state={metaState}
      item={item}
      notFoundMessage="Movie not found"
      hasBackdrop
      cover={(meta, link) => (
        <MediaCover
          coverUrl={
            meta
              ? meta.posterPath
                ? tmdbImageUrl(meta.posterPath, "w500")
                : null
              : (link?.coverUrl ?? null)
          }
          coverHash={meta ? meta.coverHash : link?.coverHash}
          name={meta?.name ?? link?.name ?? "Loading…"}
          width={MEDIA_DETAIL_COVER_WIDTH}
          viewTransitionName={mediaCoverTransitionName("movie", id)}
        />
      )}
      render={(meta) => ({
        name: meta.name,
        tagline: meta.tagline,
        backdrop: meta.backdropPath
          ? tmdbImageUrl(meta.backdropPath, "w1280")
          : null,
        lines: [
          [
            yearOf(meta.releaseDate),
            formatRuntime(meta.runtime),
            meta.certification,
          ]
            .filter(Boolean)
            .join(" · "),
          meta.genres.length > 0 && meta.genres.join(", "),
          meta.director,
        ],
        pills: [
          meta.voteAverage != null &&
            `TMDB ${meta.voteAverage.toFixed(1)}${
              meta.voteCount > 0 ? ` (${meta.voteCount})` : ""
            }`,
        ],
        status: (
          <StatusControl
            db={db}
            target={{
              mediaType: "movie",
              sourceId: String(meta.tmdbId),
              name: meta.name,
              platforms: [],
              releaseDate: meta.releaseDate,
            }}
            item={item}
          />
        ),
        body: (
          <>
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
          </>
        ),
      })}
    />
  );
}
