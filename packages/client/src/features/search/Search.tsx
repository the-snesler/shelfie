import type {
  BookSearchResult,
  MediaType,
  MovieSearchResult,
  SearchResult,
  TvSearchResult,
} from "@shelfie/shared";
import { useEffect, useState } from "react";
import { Link, useOutletContext, useViewTransitionState } from "react-router";
import IconPlus from "~icons/tabler/plus";
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

const SECTION_LABELS: Record<MediaType, string> = {
  game: "Games",
  movie: "Movies",
  tv: "TV",
  book: "Books",
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

/** One game search result row: cover (linked to detail, view-transitioning) +
 *  name/meta + library badge. Own component so `useViewTransitionState` gets
 *  a stable hook call per result rather than inside a `.map()` callback. */
function SearchResultRow({
  result,
  inLibrary,
}: {
  result: SearchResult;
  inLibrary: boolean;
}) {
  const href = `/games/${encodeURIComponent(result.slug)}`;
  const isTransitioning = useViewTransitionState(href);
  const platform = selectPlatform([], result.platforms, []);

  return (
    <li>
      <Link
        to={href}
        viewTransition
        state={{ coverUrl: result.coverUrl, platform, name: result.name }}
        className="flex w-full items-center gap-3 rounded border border-divider bg-panel p-2 text-left hover:ring-1 hover:ring-accent"
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
            {[result.year, ...result.platforms].filter(Boolean).join(" · ")}
          </p>
        </div>
        {inLibrary && (
          <span className="shrink-0 rounded bg-bg px-2 py-1 text-xs font-medium text-muted">
            In library
          </span>
        )}
      </Link>
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
}: {
  db: ShelfieDatabase;
  mediaType: Exclude<MediaType, "game">;
  href: string;
  coverUrl: string | null;
  name: string;
  meta: string | null;
  sourceId: string;
  inLibrary: boolean;
}) {
  const target: LogTarget = { mediaType, sourceId, name, platforms: [] };
  const isTransitioning = useViewTransitionState(href);

  return (
    <li className="flex w-full items-center gap-3 rounded border border-divider bg-panel p-2">
      <Link
        to={href}
        viewTransition
        state={{ coverUrl, name }}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
          {meta && <p className="truncate text-xs text-muted">{meta}</p>}
        </div>
      </Link>
      {inLibrary ? (
        <span className="shrink-0 rounded bg-bg px-2 py-1 text-xs font-medium text-muted">
          In library
        </span>
      ) : (
        <button
          type="button"
          aria-label="Add to library"
          onClick={() =>
            void db.library_items.insert(newLibraryItem(target, "backlogged"))
          }
          className="shrink-0 rounded bg-accent p-1.5 text-white"
        >
          <IconPlus />
        </button>
      )}
    </li>
  );
}

/** Last-known search state, kept outside React state so a remount (e.g.
 *  navigating away to a detail page and back) can render the results list on
 *  its very first paint instead of flashing empty while the debounce +
 *  network fetches re-run — required for the view transition back to Search
 *  to find a cover box to morph into, since the browser only pairs elements
 *  present when it snapshots the new DOM, not whatever arrives ticks later. */
let cachedFilter: Filter = "all";
let cachedQuery = "";
let cachedDebounced = "";
let cachedBuckets: ResultBuckets = EMPTY_BUCKETS;

export default function Search() {
  const { db } = useOutletContext<AppOutletContext>();
  const [filter, setFilter] = useState<Filter>(cachedFilter);
  const [query, setQuery] = useState(cachedQuery);
  const [debounced, setDebounced] = useState(cachedDebounced);
  const [buckets, setBuckets] = useState<ResultBuckets>(cachedBuckets);
  const [pending, setPending] = useState(0);
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
    cachedQuery = query;
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    cachedDebounced = debounced;
    cachedBuckets = EMPTY_BUCKETS;
    setBuckets(EMPTY_BUCKETS);
    setFailed(new Set());
    if (!debounced) {
      setPending(0);
      return;
    }

    let active = true;
    setPending(MEDIA_ORDER.length);
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
          if (active) setPending((n) => n - 1);
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

  const loading = pending > 0;
  const visible = filter === "all" ? MEDIA_ORDER : [filter];
  const visibleCount = visible.reduce(
    (sum, mediaType) => sum + buckets[mediaType].length,
    0,
  );
  const allVisibleFailed =
    visible.length > 0 && visible.every((mediaType) => failed.has(mediaType));

  function renderSection(mediaType: MediaType) {
    const cap = filter === "all" ? ALL_VIEW_SECTION_CAP : Infinity;
    let rows: React.ReactNode[];
    switch (mediaType) {
      case "game":
        rows = buckets.game
          .slice(0, cap)
          .map((result) => (
            <SearchResultRow
              key={`game:${result.igdbId}`}
              result={result}
              inLibrary={existingIds.has(`game:${result.igdbId}`)}
            />
          ));
        break;
      case "movie":
        rows = buckets.movie
          .slice(0, cap)
          .map((result) => (
            <MediaSearchResultRow
              key={`movie:${result.tmdbId}`}
              db={db}
              mediaType="movie"
              href={`/movies/${result.tmdbId}`}
              coverUrl={
                result.posterPath
                  ? tmdbImageUrl(result.posterPath, "w342")
                  : null
              }
              name={result.name}
              meta={result.year != null ? String(result.year) : null}
              sourceId={String(result.tmdbId)}
              inLibrary={existingIds.has(`movie:${result.tmdbId}`)}
            />
          ));
        break;
      case "tv":
        rows = buckets.tv
          .slice(0, cap)
          .map((result) => (
            <MediaSearchResultRow
              key={`tv:${result.tmdbId}`}
              db={db}
              mediaType="tv"
              href={`/tv/${result.tmdbId}`}
              coverUrl={
                result.posterPath
                  ? tmdbImageUrl(result.posterPath, "w342")
                  : null
              }
              name={result.name}
              meta={result.year != null ? String(result.year) : null}
              sourceId={String(result.tmdbId)}
              inLibrary={existingIds.has(`tv:${result.tmdbId}`)}
            />
          ));
        break;
      case "book":
        rows = buckets.book
          .slice(0, cap)
          .map((result) => (
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
              sourceId={String(result.goodreadsId)}
              inLibrary={existingIds.has(`book:${result.goodreadsId}`)}
            />
          ));
        break;
    }
    if (rows.length === 0) return null;
    return (
      <section key={mediaType} className="flex flex-col gap-2">
        {filter === "all" && (
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {SECTION_LABELS[mediaType]}
          </h3>
        )}
        <ul className="flex flex-col gap-2">{rows}</ul>
      </section>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <div className="flex gap-2">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => selectFilter(value)}
            className={
              filter === value
                ? "rounded bg-accent px-3 py-1.5 text-sm text-white"
                : "rounded bg-bg px-3 py-1.5 text-sm text-ink ring-1 ring-divider"
            }
          >
            {label}
          </button>
        ))}
      </div>
      <input
        autoFocus
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search…"
        className="w-full rounded bg-panel px-3 py-2 text-ink outline-none ring-1 ring-divider focus:ring-accent"
      />
      {loading && <p className="text-sm text-muted">Searching…</p>}
      {!loading && debounced && allVisibleFailed && (
        <p className="text-sm text-danger">Search failed. Try again.</p>
      )}
      {!loading && debounced && visibleCount === 0 && !allVisibleFailed && (
        <p className="text-sm text-muted">No results for "{debounced}".</p>
      )}
      <div className="flex flex-col gap-4">{visible.map(renderSection)}</div>
    </div>
  );
}
