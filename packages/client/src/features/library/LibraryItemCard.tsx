import type { LibraryItem, MediaType, TvSeason } from "@shelfie/shared";
import { episodeKey, instantMoment } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useState } from "react";
import { Link, useViewTransitionState } from "react-router";
import IconPlus from "~icons/tabler/plus";
import { AnimatePresence, motion } from "motion/react";
import { Tooltip, TruncatedText } from "../../components/Tooltip";
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
  selectGameCase,
} from "../games/platforms";
import { LogPopover } from "../media/LogPopover";
import {
  MediaCover,
  MEDIA_LIBRARY_COVER_WIDTH,
  mediaCoverTransitionName,
} from "../media/MediaCover";
import {
  deriveEpisodeWatch,
  type LogTarget,
  todayLocalIsoDate,
} from "../media/libraryActions";
import { itemLogTarget } from "../media/logTarget";
import { celebrate, celebrationOrigin, isCompletion } from "../media/celebrate";
import { useLogPopover } from "../media/useLogPopover";
import {
  airingLabel,
  hasAired,
  nextUnwatched,
  upcomingEpisode,
} from "./libraryCaptions";
import type { CardMeta } from "./useLibraryData";
import { libraryProgressPercent } from "./libraryProgress";

/** Route path segment (without the leading slash) each non-game media type
 *  lives under, e.g. tv -> "tv", movie -> "movies". */
const HREF_SEGMENTS: Record<Exclude<MediaType, "game">, string> = {
  movie: "movies",
  tv: "tv",
  book: "books",
};

/** Poster rendered height (2:3 at MEDIA_LIBRARY_COVER_WIDTH) and the 16:9
 *  still width matched to it — the still stands the same height as the poster. */
const TV_STILL_HEIGHT = Math.round(MEDIA_LIBRARY_COVER_WIDTH * 0.8);
const TV_STILL_WIDTH = Math.round((TV_STILL_HEIGHT * 16) / 9);
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
  showProgressBar,
  onLogOpenChange,
}: {
  db: ShelfieDatabase;
  item: RxDocument<LibraryItem>;
  meta: CardMeta | undefined;
  caption: string | null;
  catalog?: TvSeason[];
  showProgressBar: boolean;
  /** Told when this card's log popover opens/closes, so a filtered view can
   *  keep the card mounted while an edit moves it out of the filter. Must be
   *  a stable callback. */
  onLogOpenChange?: (itemId: string, open: boolean) => void;
}) {
  const gameMeta =
    item.mediaType === "game" ? (meta as GameCardDoc | undefined) : undefined;
  const movieMeta =
    item.mediaType === "movie" ? (meta as MovieCardDoc | undefined) : undefined;
  const tvMeta =
    item.mediaType === "tv" ? (meta as TvCardDoc | undefined) : undefined;
  const bookMeta =
    item.mediaType === "book" ? (meta as BookCardDoc | undefined) : undefined;
  const posterMeta = movieMeta ?? tvMeta;
  const progress = showProgressBar ? libraryProgressPercent(item, meta) : null;

  const PROGRESS_RADIUS = 12;
  const progress_dasharray = 2 * Math.PI * PROGRESS_RADIUS;
  const progress_dashoffset =
    progress != null ? progress_dasharray * (1 - progress / 100) : 0;

  const nextUp =
    item.mediaType === "tv" && catalog
      ? nextUnwatched(catalog, item.watchedEpisodes)
      : null;

  const today = todayLocalIsoDate();
  const airedNext = nextUp && hasAired(nextUp, today) ? nextUp : null;
  const upcoming =
    item.mediaType === "tv" && !airedNext
      ? upcomingEpisode(nextUp, tvMeta, item.watchedEpisodes, today)
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

  const caseKey =
    item.mediaType === "game"
      ? selectGameCase(
          item.platforms,
          gameMeta?.platforms ?? [],
          gameMeta?.platformReleaseDates ?? [],
          item.storefront,
        )
      : null;

  const cardWidth = airedNext
    ? MEDIA_LIBRARY_COVER_WIDTH + TV_STILL_GAP + TV_STILL_WIDTH
    : item.mediaType === "game"
      ? gameCoverWidth(caseKey, LIBRARY_COVER_SCALE)
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
        coverHash={meta?.coverHash}
        caseKey={caseKey}
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
        coverHash={meta?.coverHash}
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
    airedNext?.stillPath != null
      ? tmdbImageUrl(airedNext.stillPath, "w300")
      : null;

  const followingUp =
    catalog && airedNext
      ? nextUnwatched(
          catalog,
          item.watchedEpisodes,
          episodeKey(airedNext.season, airedNext.episode),
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
    if (!airedNext) return;
    const key = episodeKey(airedNext.season, airedNext.episode);
    // Read before the write: finishing the season moves this card.
    const origin = celebrationOrigin(document.activeElement);
    let completed = false;
    await item.incrementalModify((docData) => {
      const derived = deriveEpisodeWatch(docData, tvMeta, (current) =>
        key in current ? current : { ...current, [key]: instantMoment() },
      );
      completed = isCompletion(docData.status, derived.status);
      return { ...docData, ...derived, updatedAt: Date.now() };
    });
    if (completed) celebrate(origin);
  }

  const logTarget = itemLogTarget(item, meta);

  const displayCaption = airedNext
    ? `S${airedNext.season}E${airedNext.episode} ${airedNext.name}${caption ? ` · ${caption}` : ""}`
    : nextUp
      ? `S${nextUp.season}E${nextUp.episode}${caption ? ` · ${caption}` : ""}`
      : caption;

  return (
    <div className="flex flex-col" style={{ width: `${cardWidth}px` }}>
      <div
        className="relative flex items-end"
        style={{ height: "var(--shelf-cover-h)" }}
      >
        {href ? (
          <Link
            to={href}
            viewTransition
            state={{
              coverUrl: cover,
              coverHash: meta?.coverHash,
              caseKey,
              name,
            }}
            className="rounded text-left"
          >
            {coverBox}
          </Link>
        ) : (
          <div className="cursor-default rounded text-left opacity-60">
            {coverBox}
          </div>
        )}
        {airedNext && href && (
          <Link
            to={href}
            viewTransition
            state={{
              coverUrl: cover,
              coverHash: meta?.coverHash,
              caseKey,
              name,
            }}
            className="relative overflow-hidden rounded-lg bg-panel -ml-14 z-10 poster"
            style={{ height: `${TV_STILL_HEIGHT}px`, aspectRatio: "16 / 9" }}
          >
            <AnimatePresence initial={false}>
              <motion.div
                key={episodeKey(airedNext.season, airedNext.episode)}
                initial={{ opacity: 0, x: 28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -28 }}
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
                className="absolute inset-0"
              >
                {stillUrl ? (
                  <img
                    src={stillUrl}
                    alt={airedNext.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-muted">
                    {airedNext.name}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </Link>
        )}
        {progress != null && (
          // <div
          //   role="progressbar"
          //   aria-label={`${name} progress`}
          //   aria-valuemin={0}
          //   aria-valuemax={100}
          //   aria-valuenow={Math.round(progress)}
          //   className="absolute inset-x-2 bottom-2 z-20 h-1 overflow-hidden rounded-full bg-black/55"
          // >
          //   <div
          //     className="h-full rounded-full bg-accent"
          //     style={{ width: `${progress}%` }}
          //   />
          // </div>
          <svg
            role="progressbar"
            aria-label={`${name} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            className="absolute left-1 bottom-1 w-8 h-8 z-20 overflow-hidden drop-shadow-lg"
            width="32"
            height="32"
          >
            <circle
              r={PROGRESS_RADIUS}
              cx="16"
              cy="16"
              fill="transparent"
              stroke-width="6px"
              className="stroke-panel/50"
            ></circle>
            <circle
              r={PROGRESS_RADIUS}
              cx="16"
              cy="16"
              fill="transparent"
              stroke-width="6px"
              stroke-dasharray={progress_dasharray}
              stroke-dashoffset={progress_dashoffset}
              stroke-linecap="round"
              className="stroke-green-400 transition-[stroke-dashoffset] duration-300 ease-out"
              transform="rotate(-90 16 16)"
            ></circle>
          </svg>
        )}
      </div>
      <div style={{ height: "var(--shelf-ledge-h)" }} aria-hidden />
      <div
        className="flex w-full min-w-0 items-start justify-between gap-0.5 pt-1.5"
        style={{ height: "var(--shelf-label-h)" }}
      >
        <div className="min-w-0 flex-1 text-left">
          <TruncatedText as="p" className="text-[13px] font-medium text-ink">
            {name}
          </TruncatedText>
          {airedNext ? (
            <div className="relative h-4 overflow-hidden">
              <AnimatePresence initial={false}>
                <motion.p
                  key={episodeKey(airedNext.season, airedNext.episode)}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  className="absolute inset-x-0 top-0 text-xs text-muted"
                >
                  <TruncatedText className="block">
                    {displayCaption}
                  </TruncatedText>
                </motion.p>
              </AnimatePresence>
            </div>
          ) : upcoming ? (
            // Cards are too narrow for "S5E1 · Airs Oct 15"; the episode
            // lives in the tooltip (and on the calendar).
            <Tooltip
              content={`S${upcoming.season}E${upcoming.episode} · ${airingLabel(upcoming.airDate, today)}`}
            >
              <p className="truncate text-xs text-accent">
                {airingLabel(upcoming.airDate, today)}
              </p>
            </Tooltip>
          ) : (
            <TruncatedText as="p" className="text-xs text-muted">
              {displayCaption}
            </TruncatedText>
          )}
        </div>
        {airedNext ? (
          <input
            type="checkbox"
            checked={false}
            aria-label={`Mark S${airedNext.season}E${airedNext.episode} watched`}
            onChange={() => void markNextWatched()}
            className="mt-0.5 size-5 shrink-0 cursor-pointer appearance-none rounded-full border-2 border-current bg-transparent text-faint hover:text-accent"
          />
        ) : (
          <CardLogButton
            db={db}
            item={item}
            target={logTarget}
            onOpenChange={onLogOpenChange}
          />
        )}
      </div>
    </div>
  );
}

/** A card's "+" button. Like `Tooltip`, the closed state is just a button:
 *  floating-ui's reference ref re-renders its owner on mount, which on a full
 *  shelf doubles the cost of mounting the library. Coming back from a detail
 *  page, that mount runs inside the view transition's update callback, with
 *  the old page frozen on screen. The popover hooks mount on the first click
 *  and stay mounted after it. */
function CardLogButton({
  db,
  item,
  target,
  onOpenChange,
}: {
  db: ShelfieDatabase;
  item: RxDocument<LibraryItem>;
  target: LogTarget;
  onOpenChange?: (itemId: string, open: boolean) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    onOpenChange?.(item.id, open);
  }, [onOpenChange, item.id, open]);

  return (
    <>
      <button
        type="button"
        aria-label="Log activity"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          setAnchor(event.currentTarget);
          setOpen(true);
        }}
        className="shrink-0 rounded text-xl leading-none text-faint hover:text-accent"
      >
        <IconPlus />
      </button>
      {anchor && (
        <CardLogPopover
          anchor={anchor}
          open={open}
          onOpenChange={setOpen}
          db={db}
          item={item}
          target={target}
        />
      )}
    </>
  );
}

function CardLogPopover({
  anchor,
  open,
  onOpenChange,
  db,
  item,
  target,
}: {
  anchor: HTMLButtonElement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  db: ShelfieDatabase;
  item: RxDocument<LibraryItem>;
  target: LogTarget;
}) {
  const popover = useLogPopover({ reference: anchor, open, onOpenChange });
  return <LogPopover popover={popover} db={db} target={target} item={item} />;
}
