import type { LibraryItem, MediaType, TvSeason } from "@shelfie/shared";
import { episodeKey } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect } from "react";
import { Link, useViewTransitionState } from "react-router";
import IconPlus from "~icons/tabler/plus";
import { AnimatePresence, motion } from "motion/react";
import { gameImageUrl, tmdbImageUrl } from "../../images";
import type { BookCardDoc } from "../../db/bookCards";
import type { ShelfieDatabase } from "../../db/database";
import type { GameCardDoc } from "../../db/gameCards";
import type { MovieCardDoc } from "../../db/movieCards";
import type { TvCardDoc } from "../../db/tvCards";
import { GameCover } from "../games/GameCover";
import {
  gameCoverTransitionName,
  LIBRARY_COVER_SCALE,
  gameCoverWidth,
  selectPlatform,
} from "../games/platforms";
import { LogPopover } from "../media/LogPopover";
import {
  MediaCover,
  MEDIA_LIBRARY_COVER_WIDTH,
  mediaCoverTransitionName,
} from "../media/MediaCover";
import {
  releaseDateFromEpoch,
  releaseDateFromYear,
} from "../media/libraryActions";
import type { LogTarget } from "../media/libraryActions";
import { useLogPopover } from "../media/useLogPopover";
import { nextUnwatched } from "./libraryCaptions";
import type { CardMeta } from "./useLibraryData";

/** Route path segment (without the leading slash) each non-game media type
 *  lives under, e.g. tv -> "tv", movie -> "movies". */
const HREF_SEGMENTS: Record<Exclude<MediaType, "game">, string> = {
  movie: "movies",
  tv: "tv",
  book: "books",
};

/** Poster rendered height (2:3 at MEDIA_LIBRARY_COVER_WIDTH) and the 16:9
 *  still width matched to it — the still stands the same height as the poster. */
const TV_STILL_HEIGHT = Math.round(MEDIA_LIBRARY_COVER_WIDTH * 0.9); // 180
const TV_STILL_WIDTH = Math.round((TV_STILL_HEIGHT * 16) / 9); // 320
const TV_STILL_GAP = -56;

/** One library grid cell: cover (linked to detail, view-transitioning) +
 *  caption + log-activity button. Its own component so `useViewTransitionState`
 *  gets a stable hook call per item rather than inside a `.map()` callback. */
export function LibraryItemCard({
  db,
  item,
  meta,
  caption,
  catalog,
}: {
  db: ShelfieDatabase;
  item: RxDocument<LibraryItem>;
  meta: CardMeta | undefined;
  caption: string | null;
  catalog?: TvSeason[];
}) {
  const popover = useLogPopover();

  const gameMeta =
    item.mediaType === "game" ? (meta as GameCardDoc | undefined) : undefined;
  const movieMeta =
    item.mediaType === "movie" ? (meta as MovieCardDoc | undefined) : undefined;
  const tvMeta =
    item.mediaType === "tv" ? (meta as TvCardDoc | undefined) : undefined;
  const bookMeta =
    item.mediaType === "book" ? (meta as BookCardDoc | undefined) : undefined;
  const posterMeta = movieMeta ?? tvMeta;

  const nextUp =
    item.mediaType === "tv" && catalog
      ? nextUnwatched(catalog, item.watchedEpisodes)
      : null;

  const name =
    gameMeta?.name ??
    movieMeta?.name ??
    tvMeta?.name ??
    bookMeta?.name ??
    item.sourceId;

  const href =
    item.mediaType === "game"
      ? gameMeta?.slug
        ? `/games/${encodeURIComponent(gameMeta.slug)}`
        : null
      : `/${HREF_SEGMENTS[item.mediaType]}/${encodeURIComponent(item.sourceId)}`;

  const isTransitioning = useViewTransitionState(href ?? "/__no_transition__");

  const platform =
    item.mediaType === "game"
      ? selectPlatform(
          item.platforms,
          gameMeta?.platforms ?? [],
          gameMeta?.platformReleaseDates ?? [],
        )
      : null;

  const cardWidth = nextUp
    ? MEDIA_LIBRARY_COVER_WIDTH + TV_STILL_GAP + TV_STILL_WIDTH
    : item.mediaType === "game"
      ? gameCoverWidth(platform, LIBRARY_COVER_SCALE)
      : MEDIA_LIBRARY_COVER_WIDTH;

  const cover =
    item.mediaType === "game"
      ? gameMeta?.coverImageId
        ? gameImageUrl("t_cover_big", gameMeta.coverImageId)
        : null
      : item.mediaType === "book"
        ? (bookMeta?.coverUrl ?? null)
        : posterMeta?.posterPath
          ? tmdbImageUrl(posterMeta.posterPath, "w342")
          : null;

  const coverBox =
    item.mediaType === "game" ? (
      <GameCover
        coverUrl={cover}
        platform={platform}
        name={name}
        scale={LIBRARY_COVER_SCALE}
        viewTransitionName={
          gameMeta?.slug && isTransitioning
            ? gameCoverTransitionName(gameMeta.slug)
            : undefined
        }
      />
    ) : (
      <MediaCover
        coverUrl={cover}
        name={name}
        width={MEDIA_LIBRARY_COVER_WIDTH}
        mediaType={item.mediaType}
        viewTransitionName={
          isTransitioning
            ? mediaCoverTransitionName(item.mediaType, item.sourceId)
            : undefined
        }
      />
    );

  const stillUrl =
    nextUp?.stillPath != null ? tmdbImageUrl(nextUp.stillPath, "w300") : null;

  const followingUp =
    catalog && nextUp
      ? nextUnwatched(
          catalog,
          item.watchedEpisodes,
          episodeKey(nextUp.season, nextUp.episode),
        )
      : null;
  const followingStillUrl = followingUp?.stillPath
    ? tmdbImageUrl(followingUp.stillPath, "w300")
    : null;

  useEffect(() => {
    if (!followingStillUrl) return;
    const image = new Image();
    image.decoding = "async";
    image.src = followingStillUrl;
    void image.decode().catch(() => {});
  }, [followingStillUrl]);

  async function markNextWatched() {
    if (!nextUp) return;
    const key = episodeKey(nextUp.season, nextUp.episode);
    await item.incrementalModify((docData) => ({
      ...docData,
      watchedEpisodes: docData.watchedEpisodes.includes(key)
        ? docData.watchedEpisodes
        : [...docData.watchedEpisodes, key],
      updatedAt: Date.now(),
    }));
  }

  const logTarget: LogTarget =
    item.mediaType === "game"
      ? {
          mediaType: "game",
          sourceId: item.sourceId,
          name,
          platforms: gameMeta?.platforms ?? [],
          releaseDate: releaseDateFromEpoch(gameMeta?.firstReleaseDate ?? null),
        }
      : {
          mediaType: item.mediaType,
          sourceId: item.sourceId,
          name,
          platforms: [],
          releaseDate: releaseDateFromYear(
            movieMeta?.year ?? tvMeta?.firstAirYear ?? bookMeta?.year ?? null,
          ),
        };

  const displayCaption = nextUp
    ? `S${nextUp.season}E${nextUp.episode} ${nextUp.name}${caption ? ` · ${caption}` : ""}`
    : caption;

  return (
    <div className="flex flex-col" style={{ width: `${cardWidth}px` }}>
      <div
        className="flex items-end"
        style={{ height: "var(--shelf-cover-h)" }}
      >
        {href ? (
          <Link
            to={href}
            viewTransition
            state={{ coverUrl: cover, platform, name }}
            className="rounded text-left"
          >
            {coverBox}
          </Link>
        ) : (
          <div className="cursor-default rounded text-left opacity-60">
            {coverBox}
          </div>
        )}
        {nextUp && href && (
          <Link
            to={href}
            viewTransition
            state={{ coverUrl: cover, platform, name }}
            className="relative overflow-hidden rounded-lg bg-panel -ml-14 z-10 poster"
            style={{ height: `${TV_STILL_HEIGHT}px`, aspectRatio: "16 / 9" }}
          >
            <AnimatePresence initial={false}>
              <motion.div
                key={episodeKey(nextUp.season, nextUp.episode)}
                initial={{ opacity: 0, x: 28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -28 }}
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
                className="absolute inset-0"
              >
                {stillUrl ? (
                  <img
                    src={stillUrl}
                    alt={nextUp.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-muted">
                    {nextUp.name}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </Link>
        )}
      </div>
      <div style={{ height: "var(--shelf-ledge-h)" }} aria-hidden />
      <div
        className="flex w-full min-w-0 items-start justify-between gap-0.5 pt-1.5"
        style={{ height: "var(--shelf-label-h)" }}
      >
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-[13px] font-medium text-ink">{name}</p>
          {nextUp ? (
            <div className="relative h-4 overflow-hidden">
              <AnimatePresence initial={false}>
                <motion.p
                  key={episodeKey(nextUp.season, nextUp.episode)}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  className="absolute inset-x-0 top-0 truncate text-xs text-muted"
                >
                  {displayCaption}
                </motion.p>
              </AnimatePresence>
            </div>
          ) : (
            <p className="truncate text-xs text-muted">{displayCaption}</p>
          )}
        </div>
        {nextUp ? (
          <input
            type="checkbox"
            checked={false}
            aria-label={`Mark S${nextUp.season}E${nextUp.episode} watched`}
            onChange={() => void markNextWatched()}
            className="mt-0.5 size-5 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-current bg-transparent text-faint hover:text-accent"
          />
        ) : (
          <button
            type="button"
            ref={popover.refs.setReference}
            {...popover.getReferenceProps()}
            aria-label="Log activity"
            onClick={() => popover.setOpen(true)}
            className="shrink-0 rounded text-xl leading-none text-faint hover:text-accent"
          >
            <IconPlus />
          </button>
        )}
      </div>
      {!nextUp && (
        <LogPopover popover={popover} db={db} target={logTarget} item={item} />
      )}
    </div>
  );
}
