import type { TvDetail as TvDetailDto, TvSeason } from "@shelfie/shared";
import { episodeKey } from "@shelfie/shared";
import { useLocation, useNavigate, useOutletContext } from "react-router";
import type { AppOutletContext } from "../../App";
import type { Route } from "./+types/TvDetail";
import { upsertTvCards } from "../../db/tvCards";
import { tmdbImageUrl } from "../../images";
import {
  deriveEpisodeWatch,
  newLibraryItem,
  releaseDateFromYear,
  todayLocalIsoDate,
} from "../media/libraryActions";
import {
  MediaCover,
  MEDIA_DETAIL_COVER_WIDTH,
  mediaCoverTransitionName,
} from "../media/MediaCover";
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
  DetailSection,
  NotFound,
  RatingPills,
  TrailerChips,
} from "./DetailChrome";

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
  const { metaState, item } = useDetailFetch<TvDetailDto>({
    db,
    url: `/api/tv/by-id/${encodeURIComponent(id)}`,
    libraryItemId: (meta) => `tv:${meta.tmdbId}`,
    upsertCards: upsertTvCards,
  });
  const handleBack = useBackNavigation();

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
    const total = metaState.meta.numberOfEpisodes;
    if (item) {
      await item.incrementalModify((docData) => ({
        ...docData,
        ...deriveEpisodeWatch(docData, total, updater),
        updatedAt: Date.now(),
      }));
    } else {
      const meta = metaState.meta;
      const derived = deriveEpisodeWatch(
        { watchedEpisodes: {}, status: "active", completedDates: [] },
        total,
        updater,
      );
      const base = newLibraryItem(
        {
          mediaType: "tv",
          sourceId: String(meta.tmdbId),
          name: meta.name,
          platforms: [],
        },
        derived.status,
      );
      await db.library_items.insert({
        ...base,
        watchedEpisodes: derived.watchedEpisodes,
        completedDates: derived.completedDates,
      });
    }
  }

  function toggleEpisode(season: number, episode: number) {
    const key = episodeKey(season, episode);
    void applyWatched((current) => {
      if (key in current) {
        const { [key]: _omit, ...rest } = current;
        return rest;
      }
      return { ...current, [key]: todayLocalIsoDate() };
    });
  }

  function toggleSeason(season: TvSeason) {
    const keys = season.episodes.map((ep) =>
      episodeKey(season.seasonNumber, ep.episodeNumber),
    );
    void applyWatched((current) => {
      const allWatched = keys.length > 0 && keys.every((k) => k in current);
      if (allWatched) {
        const next = { ...current };
        for (const k of keys) delete next[k];
        return next;
      }
      const today = todayLocalIsoDate();
      const next = { ...current };
      for (const k of keys) if (!(k in next)) next[k] = today;
      return next;
    });
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
              viewTransitionName={mediaCoverTransitionName("tv", id)}
            />
          }
        />
        <DetailBodySkeleton />
      </DetailPage>
    );
  }

  if (metaState.status === "error") {
    return <NotFound message="Show not found" onBack={() => navigate("/")} />;
  }

  const meta = metaState.meta;
  const poster = meta.posterPath ? tmdbImageUrl(meta.posterPath, "w500") : null;
  const backdrop = meta.backdropPath
    ? tmdbImageUrl(meta.backdropPath, "w1280")
    : null;

  const watchedEpisodes = item?.watchedEpisodes ?? {};
  const watchedCount = Object.keys(watchedEpisodes).filter(
    (k) => !k.startsWith("s0e"),
  ).length;
  const percent =
    meta.numberOfEpisodes > 0
      ? Math.round((watchedCount / meta.numberOfEpisodes) * 100)
      : 0;
  const seasons = orderedSeasons(meta.seasons);

  return (
    <DetailPage onBack={handleBack}>
      <DetailBackdrop src={backdrop} />
      <DetailHero
        overlap
        name={meta.name}
        tagline={meta.tagline}
        lines={[
          [meta.firstAirYear, meta.status, meta.certification]
            .filter(Boolean)
            .join(" · "),
          meta.genres.length > 0 && meta.genres.join(", "),
          [...meta.networks, ...meta.createdBy].filter(Boolean).join(" · "),
        ]}
        cover={
          <MediaCover
            coverUrl={poster}
            name={meta.name}
            width={MEDIA_DETAIL_COVER_WIDTH}
            viewTransitionName={mediaCoverTransitionName("tv", id)}
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
              mediaType: "tv",
              sourceId: String(meta.tmdbId),
              name: meta.name,
              platforms: [],
              releaseDate: releaseDateFromYear(meta.firstAirYear),
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
      {meta.numberOfEpisodes > 0 && (
        <DetailSection title="Episodes">
          <div className="flex flex-col gap-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-well ring-1 ring-divider">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-xs text-muted">
              {watchedCount}/{meta.numberOfEpisodes} episodes · {percent}%
            </p>
          </div>
        </DetailSection>
      )}
      {seasons.length > 0 && (
        <div className="flex flex-col gap-4">
          {seasons.map((season) => {
            const keys = season.episodes.map((ep) =>
              episodeKey(season.seasonNumber, ep.episodeNumber),
            );
            const seasonWatched = keys.filter(
              (k) => k in watchedEpisodes,
            ).length;
            const allWatched = keys.length > 0 && seasonWatched === keys.length;
            return (
              <div
                key={season.seasonNumber}
                className="flex flex-col gap-2.5 rounded-xl border border-divider bg-panel/60 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">
                    {season.seasonNumber === 0
                      ? "Specials"
                      : season.name || `Season ${season.seasonNumber}`}
                    <span className="ml-2 text-xs font-normal text-faint">
                      {seasonWatched}/{keys.length}
                    </span>
                  </h3>
                  <button
                    type="button"
                    disabled={item === undefined || keys.length === 0}
                    onClick={() => toggleSeason(season)}
                    className="rounded-md bg-well px-2.5 py-1 text-xs text-ink ring-1 ring-divider hover:ring-accent disabled:opacity-50"
                  >
                    {allWatched
                      ? "Mark season unwatched"
                      : "Mark season watched"}
                  </button>
                </div>
                <ul className="flex flex-col">
                  {season.episodes.map((ep) => {
                    const key = episodeKey(
                      season.seasonNumber,
                      ep.episodeNumber,
                    );
                    const watched = key in watchedEpisodes;
                    return (
                      <li key={key}>
                        <label className="-mx-1.5 flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 text-sm hover:bg-well/60">
                          <input
                            type="checkbox"
                            checked={watched}
                            disabled={item === undefined}
                            onChange={() =>
                              toggleEpisode(
                                season.seasonNumber,
                                ep.episodeNumber,
                              )
                            }
                            className="size-4 accent-accent"
                          />
                          <span className="shrink-0 text-xs text-faint tabular-nums">
                            S{season.seasonNumber}E{ep.episodeNumber}
                          </span>
                          <span className={watched ? "text-muted" : "text-ink"}>
                            {ep.name}
                          </span>
                          {ep.airDate && (
                            <span className="ml-auto shrink-0 text-xs text-faint">
                              {ep.airDate}
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </DetailPage>
  );
}
