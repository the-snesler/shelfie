import type {
  BookSearchResult,
  MediaType,
  MovieSearchResult,
  SearchResult,
  TvSearchResult,
} from "@shelfie/shared";
import { useEffect, useState } from "react";
import {
  Link,
  useOutletContext,
  useSearchParams,
  useViewTransitionState,
} from "react-router";
import IconPlus from "~icons/tabler/plus";
import IconSearch from "~icons/tabler/search";
import type { AppOutletContext } from "../../App";
import { authFetch } from "../../auth";
import { tmdbImageUrl } from "../../images";
import type { ShelfieDatabase } from "../../db/database";
import { GameCover } from "../games/GameCover";
import {
  gameCoverTransitionName,
  SEARCH_COVER_SCALE,
  selectPlatform,
} from "../games/platforms";
import {
  MediaCover,
  mediaCoverTransitionName,
  MEDIA_SEARCH_COVER_WIDTH,
} from "../media/MediaCover";
import type { LogTarget } from "../media/libraryActions";
import { newLibraryItem } from "../media/libraryActions";

type Filter = "all" | MediaType;

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "game", label: "Games" },
  { value: "movie", label: "Movies" },
  { value: "tv", label: "TV" },
  { value: "book", label: "Books" },
];

const SEARCH_ENDPOINTS: Record<MediaType, string> = {
  game: "/api/games/search",
  movie: "/api/movies/search",
  tv: "/api/tv/search",
  book: "/api/books/search",
};

/** Section order in the unfiltered ("All") view. */
const MEDIA_ORDER: readonly MediaType[] = ["game", "movie", "tv", "book"];

const MEDIA_LABELS: Record<MediaType, string> = {
  game: "Game",
  movie: "Movie",
  tv: "TV Show",
  book: "Book",
};

/** Max rows per section in the "All" view; pick a filter for the full list. */
const ALL_VIEW_SECTION_CAP = 6;

/** Per-medium result buckets. Each source is fetched independently and fills
 *  its own bucket as it lands (Goodreads is deliberately slow server-side),
 *  so fast sources never wait on slow ones — and rows always render from the
 *  bucket matching their own shape, never from whatever the active filter
 *  happens to be. */
interface ResultBuckets {
  game: SearchResult[];
  movie: MovieSearchResult[];
  tv: TvSearchResult[];
  book: BookSearchResult[];
}

const EMPTY_BUCKETS: ResultBuckets = { game: [], movie: [], tv: [], book: [] };

/** "On shelf" badge shared by every row kind. */
function OnShelfBadge() {
  return (
    <span className="shrink-0 rounded-full bg-well px-2.5 py-1 text-xs font-medium text-accent ring-1 ring-divider">
      On shelf
    </span>
  );
}

/** One game search result row: cover (linked to detail, view-transitioning) +
 *  name/meta + library badge. Own component so `useViewTransitionState` gets
 *  a stable hook call per result rather than inside a `.map()` callback. */
function SearchResultRow({
  db,
  result,
  inLibrary,
  typeLabel,
}: {
  db: ShelfieDatabase;
  result: SearchResult;
  inLibrary: boolean;
  typeLabel?: string;
}) {
  const href = `/games/${encodeURIComponent(result.slug)}`;
  const isTransitioning = useViewTransitionState(href);
  const platform = selectPlatform([], result.platforms, []);
  const target: LogTarget = {
    mediaType: "game",
    sourceId: String(result.igdbId),
    name: result.name,
    platforms: result.platforms,
  };

  return (
    <li className="flex w-full items-center gap-4 rounded-lg p-2 hover:bg-well/70">
      <Link
        to={href}
        viewTransition
        state={{ coverUrl: result.coverUrl, platform, name: result.name }}
        className="flex min-w-0 flex-1 items-center gap-4 text-left"
      >
        <div className="shrink-0">
          <GameCover
            coverUrl={result.coverUrl}
            platform={platform}
            name={result.name}
            scale={SEARCH_COVER_SCALE}
            viewTransitionName={
              isTransitioning ? gameCoverTransitionName(result.slug) : undefined
            }
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{result.name}</p>
          <p className="truncate text-xs text-muted">
            {[typeLabel, result.year, ...result.platforms]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </Link>
      {inLibrary ? (
        <OnShelfBadge />
      ) : (
        <button
          type="button"
          aria-label="Add to library"
          onClick={() =>
            void db.library_items.insert(newLibraryItem(target, "backlogged"))
          }
          className="shrink-0 rounded-full bg-accent p-1.5 text-accent-ink hover:brightness-110"
        >
          <IconPlus />
        </button>
      )}
    </li>
  );
}

/** One movie/TV/book search result row: cover thumb (view-transitioning into
 *  the detail page) + name + a single meta line + a quick add-to-library
 *  button (games keep their own richer row — see `SearchResultRow` above). */
function MediaSearchResultRow({
  db,
  mediaType,
  href,
  coverUrl,
  name,
  meta,
  sourceId,
  inLibrary,
  typeLabel,
}: {
  db: ShelfieDatabase;
  mediaType: Exclude<MediaType, "game">;
  href: string;
  coverUrl: string | null;
  name: string;
  meta: string | null;
  sourceId: string;
  inLibrary: boolean;
  typeLabel?: string;
}) {
  const target: LogTarget = { mediaType, sourceId, name, platforms: [] };
  const isTransitioning = useViewTransitionState(href);
  const subtitle = [typeLabel, meta].filter(Boolean).join(" · ");

  return (
    <li className="flex w-full items-center gap-4 rounded-lg p-2 hover:bg-well/70">
      <Link
        to={href}
        viewTransition
        state={{ coverUrl, name }}
        className="flex min-w-0 flex-1 items-center gap-4 text-left"
      >
        <div className="shrink-0">
          <MediaCover
            coverUrl={coverUrl}
            name={name}
            width={MEDIA_SEARCH_COVER_WIDTH}
            mediaType={mediaType}
            viewTransitionName={
              isTransitioning
                ? mediaCoverTransitionName(mediaType, sourceId)
                : undefined
            }
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{name}</p>
          {subtitle && (
            <p className="truncate text-xs text-muted">{subtitle}</p>
          )}
        </div>
      </Link>
      {inLibrary ? (
        <OnShelfBadge />
      ) : (
        <button
          type="button"
          aria-label="Add to library"
          onClick={() =>
            void db.library_items.insert(newLibraryItem(target, "backlogged"))
          }
          className="shrink-0 rounded-full bg-accent p-1.5 text-accent-ink hover:brightness-110"
        >
          <IconPlus />
        </button>
      )}
    </li>
  );
}

/** Last-known search state, kept outside React state so a remount (e.g.
 *  navigating away to a detail page and back) can render the results list on
 *  first paint — the query itself lives in the URL (`?q=`), which the sidebar
 *  search field owns; these caches only keep result rows present for the
 *  view transition snapshot. */
let cachedFilter: Filter = "all";
let cachedDebounced = "";
let cachedBuckets: ResultBuckets = EMPTY_BUCKETS;

export default function Search() {
  const { db } = useOutletContext<AppOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const [filter, setFilter] = useState<Filter>(cachedFilter);
  const [debounced, setDebounced] = useState(query.trim());
  const [buckets, setBuckets] = useState<ResultBuckets>(
    query.trim() === cachedDebounced ? cachedBuckets : EMPTY_BUCKETS,
  );
  const [settled, setSettled] = useState<ReadonlySet<MediaType>>(
    query.trim() === cachedDebounced ? new Set(MEDIA_ORDER) : new Set(),
  );
  const [failed, setFailed] = useState<ReadonlySet<MediaType>>(new Set());
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const sub = db.library_items.find().$.subscribe((found) => {
      setExistingIds(
        new Set(found.map((item) => `${item.mediaType}:${item.sourceId}`)),
      );
    });
    return () => sub.unsubscribe();
  }, [db]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    cachedDebounced = debounced;
    cachedBuckets = EMPTY_BUCKETS;
    setBuckets(EMPTY_BUCKETS);
    setFailed(new Set());
    setSettled(new Set());
    if (!debounced) return;

    let active = true;
    for (const mediaType of MEDIA_ORDER) {
      void authFetch(
        `${SEARCH_ENDPOINTS[mediaType]}?q=${encodeURIComponent(debounced)}`,
      )
        .then((res) => {
          if (!res.ok) throw new Error(`search failed: ${res.status}`);
          return res.json() as Promise<ResultBuckets[typeof mediaType]>;
        })
        .then((rows) => {
          if (!active) return;
          setBuckets((prev) => {
            const next = { ...prev, [mediaType]: rows };
            cachedBuckets = next;
            return next;
          });
        })
        .catch(() => {
          if (active) {
            setFailed((prev) => new Set(prev).add(mediaType));
          }
        })
        .finally(() => {
          if (active) setSettled((prev) => new Set(prev).add(mediaType));
        });
    }
    return () => {
      active = false;
    };
  }, [debounced]);

  function selectFilter(next: Filter) {
    cachedFilter = next;
    setFilter(next);
  }

  const visible = filter === "all" ? MEDIA_ORDER : [filter];
  const visibleSettled = visible.every((mediaType) => settled.has(mediaType));
  const loading = !!debounced && !visibleSettled;
  const visibleCount = visible.reduce(
    (sum, mediaType) => sum + buckets[mediaType].length,
    0,
  );
  const allVisibleFailed =
    visible.length > 0 && visible.every((mediaType) => failed.has(mediaType));

  function renderRow(
    mediaType: MediaType,
    index: number,
    withType: boolean,
  ): React.ReactNode {
    const typeLabel = withType ? MEDIA_LABELS[mediaType] : undefined;
    switch (mediaType) {
      case "game": {
        const result = buckets.game[index];
        return (
          <SearchResultRow
            key={`game:${result.igdbId}`}
            db={db}
            result={result}
            typeLabel={typeLabel}
            inLibrary={existingIds.has(`game:${result.igdbId}`)}
          />
        );
      }
      case "movie": {
        const result = buckets.movie[index];
        return (
          <MediaSearchResultRow
            key={`movie:${result.tmdbId}`}
            db={db}
            mediaType="movie"
            href={`/movies/${result.tmdbId}`}
            coverUrl={
              result.posterPath ? tmdbImageUrl(result.posterPath, "w342") : null
            }
            name={result.name}
            meta={result.year != null ? String(result.year) : null}
            typeLabel={typeLabel}
            sourceId={String(result.tmdbId)}
            inLibrary={existingIds.has(`movie:${result.tmdbId}`)}
          />
        );
      }
      case "tv": {
        const result = buckets.tv[index];
        return (
          <MediaSearchResultRow
            key={`tv:${result.tmdbId}`}
            db={db}
            mediaType="tv"
            href={`/tv/${result.tmdbId}`}
            coverUrl={
              result.posterPath ? tmdbImageUrl(result.posterPath, "w342") : null
            }
            name={result.name}
            meta={result.year != null ? String(result.year) : null}
            typeLabel={typeLabel}
            sourceId={String(result.tmdbId)}
            inLibrary={existingIds.has(`tv:${result.tmdbId}`)}
          />
        );
      }
      case "book": {
        const result = buckets.book[index];
        return (
          <MediaSearchResultRow
            key={`book:${result.goodreadsId}`}
            db={db}
            mediaType="book"
            href={`/books/${result.goodreadsId}`}
            coverUrl={result.coverUrl}
            name={result.name}
            meta={
              [result.authors.join(", "), result.year]
                .filter(Boolean)
                .join(" · ") || null
            }
            typeLabel={typeLabel}
            sourceId={String(result.goodreadsId)}
            inLibrary={existingIds.has(`book:${result.goodreadsId}`)}
          />
        );
      }
    }
  }

  const rows: React.ReactNode[] = [];
  if (filter === "all") {
    for (let i = 0; ; i++) {
      let any = false;
      for (const mediaType of MEDIA_ORDER) {
        if (i < ALL_VIEW_SECTION_CAP && i < buckets[mediaType].length) {
          rows.push(renderRow(mediaType, i, true));
          any = true;
        }
      }
      if (!any) break;
    }
  } else {
    for (let i = 0; i < buckets[filter].length; i++) {
      rows.push(renderRow(filter, i, false));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-8 md:px-8">
      <header className="flex flex-col gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          {debounced ? <>Results for “{debounced}”</> : "Search"}
        </h1>
        {/* Below md the sidebar collapses to an icon rail, so the page keeps
            its own search field there. Desktop types into the sidebar. */}
        <div className="relative md:hidden">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) =>
              setSearchParams(e.target.value ? { q: e.target.value } : {}, {
                replace: true,
              })
            }
            placeholder="Search everything…"
            className="w-full rounded-lg border border-divider bg-well py-2 pr-3 pl-9 text-ink placeholder:text-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>
        <div className="flex w-fit gap-1 rounded-lg bg-well p-1 ring-1 ring-divider">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => selectFilter(value)}
              className={
                filter === value
                  ? "rounded-md bg-panel px-3 py-1 text-sm font-medium text-ink shadow-sm"
                  : "rounded-md px-3 py-1 text-sm text-muted hover:text-ink"
              }
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      {!debounced && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <IconSearch className="size-8 text-faint" />
          <p className="font-display text-xl text-ink">
            Find something for the shelf
          </p>
          <p className="text-sm text-muted">
            Games, movies, TV shows, and books — all in one search.
          </p>
        </div>
      )}
      {loading && <p className="px-2 text-sm text-muted">Searching…</p>}
      {!loading && debounced && allVisibleFailed && (
        <p className="px-2 text-sm text-danger">Search failed. Try again.</p>
      )}
      {!loading && debounced && visibleCount === 0 && !allVisibleFailed && (
        <p className="px-2 text-sm text-muted">No results for “{debounced}”.</p>
      )}
      {!loading && <ul className="flex flex-col">{rows}</ul>}
    </div>
  );
}
