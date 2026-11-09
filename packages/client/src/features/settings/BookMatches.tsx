import type {
  BookLinkMethod,
  BookLinkSource,
  BookSearchResult,
  ImportBookLink,
  ImportBookLinkInput,
} from "@shelfie/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { MediaCover } from "../media/MediaCover";
import { buttonClass, inputClass, request } from "./importRequest";

const METHOD_LABELS: Record<BookLinkMethod, string> = {
  manual: "Linked by you",
  ignored: "Ignored",
  library: "Matched to your library",
  title: "Matched by title",
  isbn: "Matched by ISBN",
  none: "No Goodreads match",
};

/**
 * Review and correct how an import source's books map to Goodreads. Changes
 * apply on the next import run; items already imported under an earlier
 * match stay in the library.
 */
export function BookMatches({
  source,
  running,
  lastRunAt,
}: {
  source: BookLinkSource;
  running: boolean;
  lastRunAt: number | null;
}) {
  const [links, setLinks] = useState<ImportBookLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    // Reload once a run finishes; matches change while it searches.
    if (running) return;
    let active = true;
    async function load() {
      try {
        const rows = await request<ImportBookLink[]>(
          `/api/imports/${source}/links`,
        );
        if (active) {
          setLinks(rows);
          setError(null);
        }
      } catch {
        if (active) setError("Could not load book matches.");
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [source, running, lastRunAt]);

  function replace(externalId: string, link: ImportBookLink | null) {
    setLinks(
      (rows) =>
        rows?.flatMap((row) =>
          row.externalId !== externalId ? [row] : link ? [link] : [],
        ) ?? null,
    );
  }

  if (!links && !error) return null;
  const unmatched = links?.filter((link) => link.method === "none") ?? [];
  const ignored = links?.filter((link) => link.method === "ignored") ?? [];
  const matched = (links?.length ?? 0) - unmatched.length - ignored.length;
  const needle = filter.trim().toLowerCase();
  const visible = (showAll ? (links ?? []) : unmatched).filter(
    (link) =>
      !needle ||
      link.title.toLowerCase().includes(needle) ||
      link.authors.some((author) => author.toLowerCase().includes(needle)),
  );

  return (
    <section className="mt-5 border-t border-divider pt-4">
      <h3 className="text-sm font-medium text-ink">Book matches</h3>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {links && (
        <>
          <p className="mt-2 text-xs text-muted">
            {links.length === 0
              ? "Run an import to match your BookOrbit books to Goodreads."
              : `${matched} matched · ${unmatched.length} need a match · ${ignored.length} ignored. Changes apply on the next import; books already imported under an earlier match stay in your library.`}
          </p>
          {links.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(event) => setShowAll(event.currentTarget.checked)}
                />
                Show all books
              </label>
              <input
                className={`${inputClass} mt-0 max-w-xs`}
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.currentTarget.value)}
                placeholder="Filter by title or author"
                aria-label="Filter book matches"
              />
            </div>
          )}
          {links.length > 0 && visible.length === 0 && (
            <p className="mt-3 text-sm text-muted">
              {showAll || needle
                ? "No books match this filter."
                : "Every book has a match."}
            </p>
          )}
          <ul className="mt-3 flex flex-col divide-y divide-divider">
            {visible.map((link) => (
              <MatchRow
                key={link.externalId}
                source={source}
                link={link}
                disabled={running}
                onChange={(next) => replace(link.externalId, next)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function MatchRow({
  source,
  link,
  disabled,
  onChange,
}: {
  source: BookLinkSource;
  link: ImportBookLink;
  disabled: boolean;
  onChange: (link: ImportBookLink | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/imports/${source}/links/${encodeURIComponent(link.externalId)}`;

  async function save(goodreadsId: number | null) {
    setBusy(true);
    setError(null);
    try {
      const body: ImportBookLinkInput = { goodreadsId };
      onChange(
        await request<ImportBookLink>(path, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      setPicking(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save match.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      await request(path, { method: "DELETE" });
      onChange(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not reset match.",
      );
    } finally {
      setBusy(false);
    }
  }

  const automatic = !["manual", "ignored"].includes(link.method);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-ink">{link.title}</p>
          <p className="text-xs text-muted">
            {link.authors.join(", ") || "Unknown author"} ·{" "}
            {METHOD_LABELS[link.method]}
            {link.goodreadsId !== null && (
              <>
                {" · "}
                <Link
                  className="text-accent hover:underline"
                  to={`/books/${link.goodreadsId}`}
                >
                  View match
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={buttonClass}
            type="button"
            disabled={disabled || busy}
            onClick={() => setPicking((open) => !open)}
            aria-expanded={picking}
          >
            {link.goodreadsId === null ? "Choose book" : "Change"}
          </button>
          {link.method !== "ignored" && (
            <button
              className={buttonClass}
              type="button"
              disabled={disabled || busy}
              onClick={() => void save(null)}
            >
              Ignore
            </button>
          )}
          {!automatic && (
            <button
              className={buttonClass}
              type="button"
              disabled={disabled || busy}
              onClick={() => void reset()}
              title="Match this book automatically on the next import"
            >
              Match automatically
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {picking && (
        <BookPicker
          // Title alone ranks the main edition first; with the author,
          // Goodreads favours study guides "… by <author>".
          initialQuery={
            link.title.replace(/\s*\([^()]*\)\s*$/, "") || link.title
          }
          disabled={busy}
          onPick={(id) => void save(id)}
        />
      )}
    </li>
  );
}

function BookPicker({
  initialQuery,
  disabled,
  onPick,
}: {
  initialQuery: string;
  disabled: boolean;
  onPick: (goodreadsId: number) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<BookSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setResults(
        await request<BookSearchResult[]>(
          `/api/books/search?q=${encodeURIComponent(query.trim())}`,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg bg-well p-3">
      <form className="flex gap-2" onSubmit={(event) => void search(event)}>
        <input
          className={`${inputClass} mt-0`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          aria-label="Search Goodreads"
        />
        <button
          className={buttonClass}
          type="submit"
          disabled={searching || disabled}
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {results?.length === 0 && (
        <p className="mt-2 text-sm text-muted">No Goodreads results.</p>
      )}
      {results && results.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {results.map((result) => (
            <li key={result.goodreadsId} className="flex items-center gap-3">
              <MediaCover
                coverUrl={result.coverUrl}
                name={result.name}
                width={36}
                mediaType="book"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{result.name}</p>
                <p className="truncate text-xs text-muted">
                  {result.authors.join(", ")}
                  {result.pageCount ? ` · ${result.pageCount} pages` : ""}
                </p>
              </div>
              <button
                className={buttonClass}
                type="button"
                disabled={disabled}
                onClick={() => onPick(result.goodreadsId)}
              >
                Use this
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
