import type {
  BookMetadata,
  GameMetadata,
  LibraryItem,
  MediaType,
  MetaStatus,
  MovieMetadata,
  TvDetail as TvDetailDto,
  TvMetadata,
  TvSeason,
} from "@shelfie/shared";
import {
  episodeKey,
  MEDIA_TYPES,
  META_STATUSES,
  NON_FINISHED_STATUSES,
  STATUS_META_GROUP,
} from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useOutletContext,
  useSearchParams,
  useViewTransitionState,
} from "react-router";
import IconPlus from "~icons/tabler/plus";
import { AnimatePresence, motion } from "motion/react";
import type { AppOutletContext } from "../../App";
import { authFetch } from "../../auth";
import { gameImageUrl, tmdbImageUrl } from "../../images";
import { type BookCardDoc, upsertBookCards } from "../../db/bookCards";
import type { ShelfieDatabase } from "../../db/database";
import { type GameCardDoc, upsertCards } from "../../db/gameCards";
import { type MovieCardDoc, upsertMovieCards } from "../../db/movieCards";
import { type TvCardDoc, upsertTvCards } from "../../db/tvCards";
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
import { META_STATUS_LABELS } from "../media/status";
import { formatRuntime } from "../media/duration";

const MEDIA_LABELS: Record<MediaType, string> = {
  movie: "Movies",
  tv: "TV Shows",
  book: "Books",
  game: "Games",
};

/** Route path segment (without the leading slash) each non-game media type
 *  lives under, e.g. tv -> "tv", movie -> "movies". */
const HREF_SEGMENTS: Record<Exclude<MediaType, "game">, string> = {
  movie: "movies",
  tv: "tv",
  book: "books",
};

/** Any card-cache doc a library item might have metadata for. All four
 *  share the `${mediaType}:${sourceId}` id convention, so they can live in
 *  one map keyed by `LibraryItem.id`/`doc.id`. */
type CardMeta = GameCardDoc | MovieCardDoc | TvCardDoc | BookCardDoc;

/** Whole hours from IGDB seconds, e.g. 79200 -> 22. */
function toHours(seconds: number): number {
  return Math.round(seconds / 3600);
}

/** Game caption logic — unchanged from the pre-multi-media implementation. */
function formatProgress(
  item: LibraryItem,
  meta: GameCardDoc | undefined,
): string | null {
  const expected = meta?.timeToBeat?.normally ?? null;
  if (expected == null)
    return `${item.progressValue ?? 0}${item.progressFormat === "hours" ? "h" : "%"}`;

  let pct: number;
  if (item.progressFormat === "hours") {
    const h = item.progressValue ?? 0;
    if (h >= toHours(expected)) return `${h}h`;
    pct = (h / toHours(expected)) * 100;
  } else {
    pct = item.progressValue ?? 0;
    if (pct >= 100) return `${pct}%`;
  }

  pct = Math.round(pct);
  pct = Math.min(Math.max(pct, 0), 100);
  const left = toHours(expected * (1 - pct / 100));
  return pct > 0 ? `${pct}% · ${left}h left` : `~${left}h left`;
}

/** Game caption logic — unchanged from the pre-multi-media implementation.
 *  normally = IGDB "normally" seconds. */
function gameCaption(
  item: LibraryItem,
  meta: GameCardDoc | undefined,
): string | null {
  switch (STATUS_META_GROUP[item.status]) {
    case "in-progress": {
      return formatProgress(item, meta);
    }
    case "planned": {
      const expected = meta?.timeToBeat?.normally ?? null;
      return expected != null ? `~${toHours(expected)}h` : null;
    }
    case "finished": {
      return `${item.progressValue ?? 0}${item.progressFormat === "hours" ? "h" : "%"}`;
    }
  }
}

function movieCaption(meta: MovieCardDoc | undefined): string | null {
  const runtime = formatRuntime(meta?.runtime ?? null);
  if (runtime) return runtime;
  if (meta?.year != null) return String(meta.year);
  return null;
}

/** Excludes season-0 (Specials) keys from the numerator, matching the
 *  contract's derived-progress rule. */
function tvCaption(
  item: LibraryItem,
  meta: TvCardDoc | undefined,
): string | null {
  const watched = item.watchedEpisodes.filter(
    (k) => !k.startsWith("s0e"),
  ).length;
  if (meta?.numberOfEpisodes == null)
    return watched > 0 ? `${watched} ep` : null;
  return `${watched}/${meta.numberOfEpisodes} ep`;
}

/** Poster rendered height (2:3 at MEDIA_LIBRARY_COVER_WIDTH) and the 16:9
 *  still width matched to it — the still stands the same height as the poster. */
const TV_STILL_HEIGHT = Math.round(MEDIA_LIBRARY_COVER_WIDTH * 0.9); // 180
const TV_STILL_WIDTH = Math.round((TV_STILL_HEIGHT * 16) / 9); // 320
const TV_STILL_GAP = -56;

type NextEpisode = {
  season: number;
  episode: number;
  name: string;
  stillPath: string | null;
};

/** First non-special episode (season >= 1) in air order not present in
 *  `watched`. null when every non-special episode is watched. */
function nextUnwatched(
  seasons: TvSeason[],
  watched: string[],
  skipKey?: string,
): NextEpisode | null {
  const ordered = [...seasons]
    .filter((s) => s.seasonNumber !== 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .flatMap((s) =>
      [...s.episodes]
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
        .map((ep) => ({
          season: s.seasonNumber,
          episode: ep.episodeNumber,
          name: ep.name,
          stillPath: ep.stillPath,
        })),
    );
  for (const ep of ordered) {
    const key = episodeKey(ep.season, ep.episode);
    if (key !== skipKey && !watched.includes(key)) return ep;
  }
  return null;
}

function bookCaption(
  item: LibraryItem,
  meta: BookCardDoc | undefined,
): string | null {
  if (item.progressFormat === "pages" && item.progressValue != null) {
    return meta?.pageCount != null
      ? `${item.progressValue}/${meta.pageCount} p`
      : `${item.progressValue} p`;
  }
  return meta?.pageCount != null ? `${meta.pageCount} p` : null;
}

/** Left-aligned caption beneath a card. null -> render no text (footer keeps
 *  the + button and its width). Dispatches per media type; every branch
 *  tolerates missing/not-yet-fetched metadata. */
function cardCaption(
  item: LibraryItem,
  meta: CardMeta | undefined,
): string | null {
  switch (item.mediaType) {
    case "game":
      return gameCaption(item, meta as GameCardDoc | undefined);
    case "movie":
      return movieCaption(meta as MovieCardDoc | undefined);
    case "tv":
      return tvCaption(item, meta as TvCardDoc | undefined);
    case "book":
      return bookCaption(item, meta as BookCardDoc | undefined);
  }
}

/** One library grid cell: cover (linked to detail, view-transitioning) +
 *  caption + log-activity button. Its own component so `useViewTransitionState`
 *  gets a stable hook call per item rather than inside a `.map()` callback. */
function LibraryItemCard({
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

/** Last-known library snapshot, kept outside React state so a remount (e.g.
 *  navigating away to an item's detail page and back) can render the grid on
 *  its very first paint instead of flashing empty while RxDB's subscription
 *  reconnects — required for the view transition back to Library to find a
 *  cover box to morph into, since the browser only pairs elements present
 *  when it snapshots the new DOM, not whatever arrives a tick later. */
let cachedItems: RxDocument<LibraryItem>[] = [];
let cachedCards: Map<string, CardMeta> = new Map();
let cachedTvCatalogs: Map<string, TvSeason[]> = new Map();

/** Replaces every entry under `prefix` (a media type's `"<type>:"` id
 *  namespace) with a fresh snapshot from that type's collection, leaving
 *  the other three media types' entries untouched. */
function mergeCards(
  prev: Map<string, CardMeta>,
  prefix: string,
  found: readonly CardMeta[],
): Map<string, CardMeta> {
  const next = new Map(prev);
  for (const key of next.keys()) {
    if (key.startsWith(prefix)) next.delete(key);
  }
  for (const doc of found) next.set(doc.id, doc);
  return next;
}

export default function Library() {
  const { db } = useOutletContext<AppOutletContext>();
  const [items, setItems] = useState<RxDocument<LibraryItem>[]>(cachedItems);
  const [cards, setCards] = useState<Map<string, CardMeta>>(cachedCards);
  const [tvCatalogs, setTvCatalogs] =
    useState<Map<string, TvSeason[]>>(cachedTvCatalogs);

  useEffect(() => {
    const sub = db.library_items
      .find({ selector: { status: { $in: [...NON_FINISHED_STATUSES] } } })
      .$.subscribe((found) => {
        cachedItems = [...found];
        setItems(cachedItems);
      });
    return () => sub.unsubscribe();
  }, [db]);

  useEffect(() => {
    const sub = db.game_metadata.find().$.subscribe((found) => {
      cachedCards = mergeCards(cachedCards, "game:", found);
      setCards(cachedCards);
    });
    return () => sub.unsubscribe();
  }, [db]);

  useEffect(() => {
    const sub = db.movie_metadata.find().$.subscribe((found) => {
      cachedCards = mergeCards(cachedCards, "movie:", found);
      setCards(cachedCards);
    });
    return () => sub.unsubscribe();
  }, [db]);

  useEffect(() => {
    const sub = db.tv_metadata.find().$.subscribe((found) => {
      cachedCards = mergeCards(cachedCards, "tv:", found);
      setCards(cachedCards);
    });
    return () => sub.unsubscribe();
  }, [db]);

  useEffect(() => {
    const sub = db.book_metadata.find().$.subscribe((found) => {
      cachedCards = mergeCards(cachedCards, "book:", found);
      setCards(cachedCards);
    });
    return () => sub.unsubscribe();
  }, [db]);

  const idsByType = useMemo(() => {
    const byType = new Map<MediaType, string[]>();
    for (const item of items) {
      const arr = byType.get(item.mediaType);
      if (arr) arr.push(item.sourceId);
      else byType.set(item.mediaType, [item.sourceId]);
    }
    const result: Partial<Record<MediaType, string>> = {};
    for (const [type, ids] of byType) {
      result[type] = [...new Set(ids)].sort().join(",");
    }
    return result;
  }, [items]);
  const idsKey = MEDIA_TYPES.map((t) => idsByType[t] ?? "").join("|");

  const inProgressTvIds = useMemo(
    () =>
      [
        ...new Set(
          items
            .filter(
              (i) =>
                i.mediaType === "tv" &&
                STATUS_META_GROUP[i.status] === "in-progress",
            )
            .map((i) => i.sourceId),
        ),
      ].sort(),
    [items],
  );
  const tvCatalogKey = inProgressTvIds.join(",");

  useEffect(() => {
    if (idsByType.game) {
      void authFetch(`/api/games?ids=${idsByType.game}`)
        .then((res) => (res.ok ? (res.json() as Promise<GameMetadata[]>) : []))
        .then((rows) => upsertCards(db, rows))
        .catch(() => {});
    }
    if (idsByType.movie) {
      void authFetch(`/api/movies?ids=${idsByType.movie}`)
        .then((res) => (res.ok ? (res.json() as Promise<MovieMetadata[]>) : []))
        .then((rows) => upsertMovieCards(db, rows))
        .catch(() => {});
    }
    if (idsByType.tv) {
      void authFetch(`/api/tv?ids=${idsByType.tv}`)
        .then((res) => (res.ok ? (res.json() as Promise<TvMetadata[]>) : []))
        .then((rows) => upsertTvCards(db, rows))
        .catch(() => {});
    }
    if (idsByType.book) {
      void authFetch(`/api/books?ids=${idsByType.book}`)
        .then((res) => (res.ok ? (res.json() as Promise<BookMetadata[]>) : []))
        .then((rows) => upsertBookCards(db, rows))
        .catch(() => {});
    }
    // idsKey is the stable dependency; idsByType is derived from it each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, idsKey]);

  useEffect(() => {
    let active = true;
    for (const id of inProgressTvIds) {
      if (cachedTvCatalogs.has(`tv:${id}`)) continue;
      void authFetch(`/api/tv/by-id/${encodeURIComponent(id)}`)
        .then((res) => (res.ok ? (res.json() as Promise<TvDetailDto>) : null))
        .then((meta) => {
          if (!active || !meta) return;
          cachedTvCatalogs = new Map(cachedTvCatalogs).set(
            `tv:${meta.tmdbId}`,
            meta.seasons,
          );
          setTvCatalogs(cachedTvCatalogs);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
    // tvCatalogKey is the stable dep; inProgressTvIds is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvCatalogKey]);

  const [searchParams] = useSearchParams();
  const typeParam = searchParams.get("type");
  const activeType = (MEDIA_TYPES as readonly string[]).includes(
    typeParam ?? "",
  )
    ? (typeParam as MediaType)
    : null;

  const filtered = useMemo(
    () =>
      activeType
        ? items.filter((item) => item.mediaType === activeType)
        : items,
    [items, activeType],
  );

  const grouped = useMemo(() => {
    const map = new Map<MetaStatus, RxDocument<LibraryItem>[]>();
    for (const item of filtered) {
      const g = STATUS_META_GROUP[item.status];
      const arr = map.get(g);
      if (arr) arr.push(item);
      else map.set(g, [item]);
    }
    return map;
  }, [filtered]);

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
        <p className="font-display text-2xl text-ink">Your shelf is empty</p>
        <p className="text-sm">
          Search for a game, movie, show, or book to add your first one.
        </p>
      </div>
    );
  }

  const heading = activeType ? MEDIA_LABELS[activeType] : "Library";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-5 py-8 md:px-8">
      <header className="flex items-baseline gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          {heading}
        </h1>
        <span className="text-sm text-faint">
          {filtered.length} on the shelf
        </span>
      </header>
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted">
          <p className="font-display text-xl text-ink">
            No {heading.toLowerCase()} on your shelf yet
          </p>
          <p className="text-sm">Find some with the search bar.</p>
        </div>
      ) : (
        META_STATUSES.filter((g) => grouped.get(g)?.length).map((g) => (
          <section key={g} className="flex flex-col">
            <h2 className="font-display text-xl font-medium text-ink">
              {META_STATUS_LABELS[g]}
              <span className="ml-2 text-sm font-normal text-faint">
                {grouped.get(g)!.length}
              </span>
            </h2>
            <div className="shelf-rows -mt-2 flex flex-wrap items-start gap-x-6">
              {grouped.get(g)!.map((item) => (
                <LibraryItemCard
                  key={item.id}
                  db={db}
                  item={item}
                  meta={cards.get(item.id)}
                  caption={cardCaption(item, cards.get(item.id))}
                  catalog={
                    item.mediaType === "tv"
                      ? tvCatalogs.get(item.id)
                      : undefined
                  }
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
