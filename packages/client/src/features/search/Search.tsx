import type { SearchResult } from "@shelfie/shared";
import { useEffect, useState } from "react";
import { Link, useOutletContext, useViewTransitionState } from "react-router";
import type { AppOutletContext } from "../../App";
import { authFetch } from "../../auth";
import { GameCover } from "../games/GameCover";
import {
  gameCoverTransitionName,
  SEARCH_COVER_SCALE,
  selectPlatform,
} from "../games/platforms";

/** One search result row: cover (linked to detail, view-transitioning) +
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

/** Last-known search state, kept outside React state so a remount (e.g.
 *  navigating away to a game's detail page and back) can render the results
 *  list on its very first paint instead of flashing empty while the debounce
 *  + network fetch re-run — required for the view transition back to Search
 *  to find a cover box to morph into, since the browser only pairs elements
 *  present when it snapshots the new DOM, not whatever arrives ticks later. */
let cachedQuery = "";
let cachedDebounced = "";
let cachedResults: SearchResult[] = [];

export default function Search() {
  const { db } = useOutletContext<AppOutletContext>();
  const [query, setQuery] = useState(cachedQuery);
  const [debounced, setDebounced] = useState(cachedDebounced);
  const [results, setResults] = useState<SearchResult[]>(cachedResults);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const sub = db.library_items.find().$.subscribe((found) => {
      setExistingIds(new Set(found.map((item) => item.sourceId)));
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
    if (!debounced) {
      cachedResults = [];
      setResults([]);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void authFetch(`/api/games/search?q=${encodeURIComponent(debounced)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`search failed: ${res.status}`);
        return res.json() as Promise<SearchResult[]>;
      })
      .then((rows) => {
        if (active) {
          cachedResults = rows;
          setResults(rows);
        }
      })
      .catch(() => {
        if (active) setError("Search failed. Try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [debounced]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <input
        autoFocus
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for a game…"
        className="w-full rounded bg-panel px-3 py-2 text-ink outline-none ring-1 ring-divider focus:ring-accent"
      />
      {loading && <p className="text-sm text-muted">Searching…</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {!loading && debounced && results.length === 0 && !error && (
        <p className="text-sm text-muted">No results for "{debounced}".</p>
      )}
      <ul className="flex flex-col gap-2">
        {results.map((result) => (
          <SearchResultRow
            key={result.igdbId}
            result={result}
            inLibrary={existingIds.has(String(result.igdbId))}
          />
        ))}
      </ul>
    </div>
  );
}
