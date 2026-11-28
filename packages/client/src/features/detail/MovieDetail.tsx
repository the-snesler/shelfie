import type { MovieDetail as MovieDetailDto } from "@tsundo/shared";
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
import { formatIsoDay } from "../media/dates";
import { ExpandableText } from "./DetailChrome";
import { CastRail, VideoRail } from "./Rail";

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
        coverUrl: meta.posterPath
          ? tmdbImageUrl(meta.posterPath, "w500")
          : null,
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
        ],
        pills: [
          meta.voteAverage != null &&
            `TMDB ${meta.voteAverage.toFixed(1)}${
              meta.voteCount > 0 ? ` · ${meta.voteCount}` : ""
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
        about: meta.summary && (
          <ExpandableText>
            <p>{meta.summary}</p>
          </ExpandableText>
        ),
        facts: [
          { label: "Released", value: formatIsoDay(meta.releaseDate) },
          { label: "Director", value: meta.director },
          { label: "Runtime", value: formatRuntime(meta.runtime) },
          { label: "Rated", value: meta.certification },
        ],
        links: [
          meta.imdbId && {
            label: "IMDb",
            href: `https://www.imdb.com/title/${meta.imdbId}/`,
          },
          {
            label: "TMDB",
            href: `https://www.themoviedb.org/movie/${meta.tmdbId}`,
          },
        ],
        body: (
          <>
            <CastRail cast={meta.cast} />
            <VideoRail videos={meta.videos} />
          </>
        ),
      })}
    />
  );
}
