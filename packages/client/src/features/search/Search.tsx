import type { SearchResult } from "@shelfie/shared";
import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import type { AppOutletContext } from "../../App";
import { authFetch } from "../../auth";

export default function Search() {
  const { db } = useOutletContext<AppOutletContext>();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
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
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!debounced) {
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
        if (active) setResults(rows);
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
        {results.map((result) => {
          const inLibrary = existingIds.has(String(result.igdbId));
          return (
            <li key={result.igdbId}>
              <button
                type="button"
                onClick={() =>
                  navigate(`/games/${encodeURIComponent(result.slug)}`)
                }
                className="flex w-full items-center gap-3 rounded border border-divider bg-panel p-2 text-left hover:ring-1 hover:ring-accent"
              >
                <div className="h-16 w-12 shrink-0 overflow-hidden rounded bg-bg">
                  {result.coverUrl && (
                    <img
                      src={result.coverUrl}
                      alt={result.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {result.name}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {[result.year, ...result.platforms]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {inLibrary && (
                  <span className="shrink-0 rounded bg-bg px-2 py-1 text-xs font-medium text-muted">
                    In library
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
