import type { LibraryItem, SearchResult } from "@shelfie/shared";
import { useEffect, useState } from "react";
import { authFetch } from "../../auth";
import type { ShelfieDatabase } from "../../db/database";

export function Search({ db }: { db: ShelfieDatabase }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<Set<number>>(new Set());

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

  async function addToLibrary(result: SearchResult) {
    if (existingIds.has(String(result.igdbId)) || adding.has(result.igdbId)) {
      return;
    }
    setAdding((prev) => new Set(prev).add(result.igdbId));
    try {
      const now = Date.now();
      const doc: LibraryItem = {
        id: `game:${result.igdbId}`,
        mediaType: "game",
        sourceId: String(result.igdbId),
        status: "backlogged",
        progress: null,
        addedAt: now,
        updatedAt: now,
      };
      await db.library_items.insert(doc);
    } finally {
      setAdding((prev) => {
        const next = new Set(prev);
        next.delete(result.igdbId);
        return next;
      });
    }
  }

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
          const isAdding = adding.has(result.igdbId);
          return (
            <li
              key={result.igdbId}
              className="flex items-center gap-3 rounded border border-divider bg-panel p-2"
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
                  {[result.year, ...result.platforms].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button
                type="button"
                disabled={inLibrary || isAdding}
                onClick={() => void addToLibrary(result)}
                className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {inLibrary ? "In library" : isAdding ? "Adding…" : "Add"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
