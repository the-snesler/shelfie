import type { TvDetail as TvDetailDto, TvEpisode } from "@shelfie/shared";
import { episodeKey, instantMoment } from "@shelfie/shared";
import { useOutletContext } from "react-router";
import type { AppOutletContext } from "../../App";
import type { Route } from "./+types/TvDetail";
import { upsertTvCards } from "../../db/tvCards";
import { tmdbImageUrl } from "../../images";
import {
  deriveEpisodeWatch,
  newLibraryItem,
  releaseDateFromYear,
} from "../media/libraryActions";
import {
  MediaCover,
  MEDIA_DETAIL_COVER_WIDTH,
  mediaCoverTransitionName,
} from "../media/MediaCover";
import { StatusControl } from "../media/StatusControl";
import { celebrate, celebrationOrigin, isCompletion } from "../media/celebrate";
import { useDetailFetch } from "./useDetailFetch";
import { DetailScreen } from "./DetailScreen";
import { formatIsoDay, formatIsoDayRange } from "../media/dates";
import IconCheck from "~icons/tabler/check";
import { ExpandableText } from "./DetailChrome";
import { TvEpisodes } from "./TvEpisodes";
import { nextUpEpisode } from "./episodeProgress";
import { useToday } from "../media/useToday";
import { CastRail, VideoRail } from "./Rail";

export default function TvDetail({ params }: Route.ComponentProps) {
  const { db } = useOutletContext<AppOutletContext>();
  const id = params.id;
  const { metaState, item } = useDetailFetch<TvDetailDto>({
    db,
    url: `/api/tv/by-id/${encodeURIComponent(id)}`,
    libraryItemId: (meta) => `tv:${meta.tmdbId}`,
    upsertCards: upsertTvCards,
  });
  const today = useToday();

  /** Persists a `watchedEpisodes` update by deriving the next map from the
   *  document's current data at write time via `incrementalModify` (RxDB
   *  serializes these per document, so rapid toggles compose instead of
   *  racing) — or the insert path for a show not yet in the library, same
   *  lazy-add behavior as StatusControl's default click. Status/completion
   *  derivation (see `deriveEpisodeWatch`) is shared with the library
   *  grid's "next episode" quick-check so the two toggle paths never drift. */
  async function applyWatched(
    updater: (current: Record<string, string>) => Record<string, string>,
  ) {
    if (metaState.status !== "loaded") return;
    const card = metaState.meta;
    // Read before the write: the toggled checkbox may re-render away.
    const origin = celebrationOrigin(document.activeElement);
    if (item) {
      let completed = false;
      await item.incrementalModify((docData) => {
        const derived = deriveEpisodeWatch(docData, card, updater);
        completed = isCompletion(docData.status, derived.status);
        return { ...docData, ...derived, updatedAt: Date.now() };
      });
      if (completed) celebrate(origin);
    } else {
      const derived = deriveEpisodeWatch(
        { watchedEpisodes: {}, status: "active", completions: [] },
        card,
        updater,
      );
      const base = newLibraryItem(
        {
          mediaType: "tv",
          sourceId: String(card.tmdbId),
          name: card.name,
          platforms: [],
        },
        derived.status,
      );
      await db.library_items.insert({
        ...base,
        watchedEpisodes: derived.watchedEpisodes,
        completions: derived.completions,
      });
      if (isCompletion(null, derived.status)) celebrate(origin);
    }
  }

  function toggleEpisode(episode: TvEpisode) {
    const key = episodeKey(episode.seasonNumber, episode.episodeNumber);
    void applyWatched((current) => {
      if (key in current) {
        const { [key]: _omit, ...rest } = current;
        return rest;
      }
      return { ...current, [key]: instantMoment() };
    });
  }

  /** Marks `keys` watched (now, keeping existing watch moments) or
   *  unwatched. */
  function setEpisodes(keys: string[], watched: boolean) {
    void applyWatched((current) => {
      const next = { ...current };
      if (watched) {
        const now = instantMoment();
        for (const key of keys) next[key] ??= now;
      } else {
        for (const key of keys) delete next[key];
      }
      return next;
    });
  }

  return (
    <DetailScreen
      state={metaState}
      item={item}
      notFoundMessage="Show not found"
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
          viewTransitionName={mediaCoverTransitionName("tv", id)}
        />
      )}
      render={(meta) => {
        const watchedEpisodes = item?.watchedEpisodes ?? {};
        const nextUp = nextUpEpisode(
          meta.seasons,
          watchedEpisodes,
          meta.lastEpisodeToAir,
          today,
        );
        const nextAiring = meta.nextEpisodeToAir;
        return {
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
              meta.firstAirYear,
              meta.numberOfEpisodes > 0 && `${meta.numberOfEpisodes} eps`,
              meta.certification,
              meta.status,
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
                mediaType: "tv",
                sourceId: String(meta.tmdbId),
                name: meta.name,
                platforms: [],
                releaseDate:
                  meta.firstAirDate ?? releaseDateFromYear(meta.firstAirYear),
              }}
              item={item}
            />
          ),
          actions: item && nextUp?.aired && (
            <button
              type="button"
              onClick={() => toggleEpisode(nextUp.episode)}
              title={`Mark S${nextUp.episode.seasonNumber}E${nextUp.episode.episodeNumber} watched`}
              className="inline-flex max-w-full min-w-0 items-center gap-2 rounded bg-well/80 px-3 py-2 text-sm text-ink ring-1 ring-divider hover:ring-accent"
            >
              <IconCheck className="size-4 shrink-0 text-accent" />
              <span className="shrink-0 text-faint tabular-nums">
                S{nextUp.episode.seasonNumber}E{nextUp.episode.episodeNumber}
              </span>
              <span className="max-w-[16rem] truncate">
                {nextUp.episode.name}
              </span>
            </button>
          ),
          about: meta.summary && (
            <ExpandableText>
              <p>{meta.summary}</p>
            </ExpandableText>
          ),
          facts: [
            { label: "Status", value: meta.status },
            {
              label: "Aired",
              value:
                meta.inProduction || !meta.lastAirDate
                  ? meta.firstAirDate &&
                    `Since ${formatIsoDay(meta.firstAirDate)}`
                  : formatIsoDayRange(meta.firstAirDate, meta.lastAirDate),
            },
            nextAiring && {
              label: "Next",
              value: `S${nextAiring.seasonNumber}E${nextAiring.episodeNumber} · ${formatIsoDay(nextAiring.airDate)}`,
            },
            { label: "Network", value: meta.networks.join(", ") },
            { label: "Created by", value: meta.createdBy.join(", ") },
            meta.numberOfSeasons > 0 && {
              label: "Seasons",
              value: `${meta.numberOfSeasons} · ${meta.numberOfEpisodes} episodes`,
            },
            { label: "Rated", value: meta.certification },
          ],
          links: [
            meta.imdbId && {
              label: "IMDb",
              href: `https://www.imdb.com/title/${meta.imdbId}/`,
            },
            {
              label: "TMDB",
              href: `https://www.themoviedb.org/tv/${meta.tmdbId}`,
            },
          ],
          body: (
            <>
              <TvEpisodes
                key={meta.tmdbId}
                meta={meta}
                watched={watchedEpisodes}
                disabled={item === undefined}
                today={today}
                nextUp={nextUp}
                onToggle={toggleEpisode}
                onSetWatched={setEpisodes}
              />
              <CastRail cast={meta.cast} />
              <VideoRail videos={meta.videos} />
            </>
          ),
        };
      }}
    />
  );
}
