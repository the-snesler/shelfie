import type {
  BookLinkMethod,
  BookLinkSource,
  BookSearchResult,
  ImportBookLink,
} from "@shelfie/shared";
import type { Kysely } from "kysely";
import type { Database, ImportBookLinksTable } from "../db/types.js";
import { searchBooks } from "../goodreads/client.js";

/** A book as an import source describes it, before Goodreads matching. */
export interface SourceBook {
  externalId: string;
  title: string;
  authors: string[];
}

export interface BookMatch {
  /** Goodreads legacy book id; null when unmatched or ignored. */
  goodreadsId: number | null;
  method: BookLinkMethod;
}

/** A Goodreads search failed; the book stays unsaved so a later run retries it. */
export class GoodreadsLookupError extends Error {}

export interface BookMatcher {
  /**
   * Resolves a source book to a Goodreads id. `isbn` is called only when
   * title matching fails, so sources can defer a detail request. Throws
   * GoodreadsLookupError when a search fails.
   */
  match(
    book: SourceBook,
    isbn: () => Promise<string | null>,
  ): Promise<BookMatch>;
  /** A saved match that needs no new lookup, or undefined. Never searches. */
  known(book: SourceBook): Promise<BookMatch | undefined>;
}

/** Unmatched books are searched again after this long, in case Goodreads adds them. */
export const RETRY_UNMATCHED_MS = 7 * 24 * 60 * 60 * 1000;
const USER_METHODS: BookLinkMethod[] = ["manual", "ignored"];

function fold(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Drops a trailing series note: Goodreads' "(The Murderbot Diaries, #5)" or a
 * source's "(The Three-Body Problem)".
 */
function withoutSeries(title: string): string {
  return title.replace(/\s*\([^()]*\)\s*$/, "") || title;
}

/** "Frostbite: How…", "The Hobbit, or There and Back Again", "Dune - Part One". */
const SUBTITLE = /:\s|,\s+or\s|\s[-–—]\s/i;

/**
 * Titles match when equal after folding case, punctuation and a trailing
 * series note. A subtitle may be missing on one side only, so "Frostbite"
 * matches "Frostbite: How Refrigeration…" but two different "Star Wars: …"
 * books do not match each other.
 */
export function titlesMatch(a: string, b: string): boolean {
  const fullA = withoutSeries(a);
  const fullB = withoutSeries(b);
  if (fold(fullA) === fold(fullB)) return true;
  const mainA = fold(fullA.split(SUBTITLE)[0]);
  const mainB = fold(fullB.split(SUBTITLE)[0]);
  return fold(fullA) === mainB || mainA === fold(fullB);
}

/**
 * Two keys per name: letters in reading order, so "J.R.R." equals "J. R. R.",
 * and sorted words, so "Liu, Cixin" equals "Liu Cixin" or "Cixin Liu".
 */
function authorKeys(name: string): string[] {
  const [last, first] = name.split(/,\s*/);
  const ordered = (first ? `${first} ${last}` : name)
    .normalize("NFKC")
    .toLowerCase();
  const words = ordered.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.length
    ? [words.join(""), `sorted:${[...words].sort().join(" ")}`]
    : [];
}

/** True when any author appears on both sides. */
export function authorsMatch(a: string[], b: string[]): boolean {
  const keys = new Set(a.flatMap(authorKeys));
  return b.some((name) => authorKeys(name).some((key) => keys.has(key)));
}

interface LibraryBook {
  goodreadsId: number;
  title: string;
  authors: string[];
  isbn13: string | null;
}

function parseAuthors(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value)
      ? value.filter((name): name is string => typeof name === "string")
      : [];
  } catch {
    return [];
  }
}

export function publicBookLink(row: ImportBookLinksTable): ImportBookLink {
  return {
    externalId: row.external_id,
    title: row.title,
    authors: parseAuthors(row.authors),
    goodreadsId: row.goodreads_id,
    method: row.method as BookLinkMethod,
    checkedAt: row.checked_at,
  };
}

/**
 * Matches source books in priority order: a saved match, a book already in
 * the library with the same title and author, a strict title and author
 * match from Goodreads title searches, then the ISBN. Title search comes before ISBN because it
 * finds the edition a manual Shelfie search would add; an ISBN can name a
 * translated edition. Results are saved per source so later runs skip lookups.
 */
export class GoodreadsBookMatcher implements BookMatcher {
  private saved?: Map<string, ImportBookLinksTable>;
  private library?: LibraryBook[];

  constructor(
    private readonly database: Kysely<Database>,
    private readonly source: BookLinkSource,
    private readonly search: (
      q: string,
    ) => Promise<BookSearchResult[]> = searchBooks,
    private readonly now: () => number = Date.now,
  ) {}

  async known(book: SourceBook): Promise<BookMatch | undefined> {
    const saved = (await this.savedLinks()).get(book.externalId);
    return saved && !this.needsLookup(saved, book)
      ? {
          goodreadsId: saved.goodreads_id,
          method: saved.method as BookLinkMethod,
        }
      : undefined;
  }

  async match(
    book: SourceBook,
    isbn: () => Promise<string | null>,
  ): Promise<BookMatch> {
    const saved = await this.known(book);
    if (saved) return saved;
    const found = (await this.fromLibrary(book, null)) ??
      (await this.fromTitle(book)) ??
      (await this.fromIsbn(book, await isbn())) ?? {
        goodreadsId: null,
        method: "none" as const,
      };
    await this.store(book, found.goodreadsId, found.method);
    return found;
  }

  private async goodreads(q: string): Promise<BookSearchResult[]> {
    try {
      return await this.search(q);
    } catch (error) {
      throw new GoodreadsLookupError("Goodreads search failed.", {
        cause: error,
      });
    }
  }

  private needsLookup(saved: ImportBookLinksTable, book: SourceBook): boolean {
    if (USER_METHODS.includes(saved.method as BookLinkMethod)) return false;
    // Metadata edited in the source can change which book this is.
    if (
      saved.title !== book.title ||
      saved.authors !== JSON.stringify(book.authors)
    )
      return true;
    return (
      saved.method === "none" &&
      this.now() - saved.checked_at > RETRY_UNMATCHED_MS
    );
  }

  private async savedLinks(): Promise<Map<string, ImportBookLinksTable>> {
    if (!this.saved) {
      const rows = await this.database
        .selectFrom("import_book_links")
        .selectAll()
        .where("source", "=", this.source)
        .execute();
      this.saved = new Map(rows.map((row) => [row.external_id, row]));
    }
    return this.saved;
  }

  private async libraryBooks(): Promise<LibraryBook[]> {
    if (this.library) return this.library;
    const ids = (
      await this.database
        .selectFrom("library_items")
        .select("source_id")
        .where("media_type", "=", "book")
        .where("deleted", "=", 0)
        .execute()
    )
      .map((row) => Number(row.source_id))
      .filter(Number.isSafeInteger);
    const books: LibraryBook[] = [];
    // Stay well below SQLite's bound-parameter limit.
    for (let start = 0; start < ids.length; start += 500) {
      const rows = await this.database
        .selectFrom("book_metadata")
        .select(["goodreads_id", "name", "authors", "isbn13"])
        .where("goodreads_id", "in", ids.slice(start, start + 500))
        .execute();
      for (const row of rows)
        books.push({
          goodreadsId: row.goodreads_id,
          title: row.name,
          authors: parseAuthors(row.authors),
          isbn13: row.isbn13,
        });
    }
    this.library = books;
    return books;
  }

  private async fromLibrary(
    book: SourceBook,
    isbn: string | null,
  ): Promise<BookMatch | null> {
    const candidates = (await this.libraryBooks()).filter((owned) =>
      isbn
        ? owned.isbn13 === isbn
        : titlesMatch(owned.title, book.title) &&
          authorsMatch(owned.authors, book.authors),
    );
    // Two owned editions with the same title are ambiguous; let search decide.
    return candidates.length === 1
      ? { goodreadsId: candidates[0].goodreadsId, method: "library" }
      : null;
  }

  private async fromTitle(book: SourceBook): Promise<BookMatch | null> {
    const title = withoutSeries(book.title).trim();
    if (!title || !book.authors.length) return null;
    // Title alone ranks the main edition first; adding the author pulls up
    // study guides "… by <author>". It is the fallback for common titles.
    for (const query of [title, `${title} ${book.authors[0]}`]) {
      const results = await this.goodreads(query);
      // Summaries, adaptations and box sets rank near the real book, so the
      // top result alone is not trusted.
      const hit = results.find(
        (result) =>
          titlesMatch(result.name, book.title) &&
          authorsMatch(result.authors, book.authors),
      );
      if (hit) return { goodreadsId: hit.goodreadsId, method: "title" };
    }
    return null;
  }

  private async fromIsbn(
    book: SourceBook,
    rawIsbn: string | null,
  ): Promise<BookMatch | null> {
    const isbn = rawIsbn?.replace(/[^0-9Xx]/g, "").toUpperCase() ?? "";
    if (!/^(?:\d{9}[\dX]|\d{13})$/.test(isbn)) return null;
    const owned =
      isbn.length === 13 ? await this.fromLibrary(book, isbn) : null;
    if (owned) return owned;
    const [hit] = await this.goodreads(isbn);
    // An ISBN that resolves to an unrelated book points to bad source metadata.
    return hit &&
      (titlesMatch(hit.name, book.title) ||
        authorsMatch(hit.authors, book.authors))
      ? { goodreadsId: hit.goodreadsId, method: "isbn" }
      : null;
  }

  private async store(
    book: SourceBook,
    goodreadsId: number | null,
    method: BookLinkMethod,
  ): Promise<void> {
    const row: ImportBookLinksTable = {
      source: this.source,
      external_id: book.externalId,
      title: book.title,
      authors: JSON.stringify(book.authors),
      goodreads_id: goodreadsId,
      method,
      checked_at: this.now(),
    };
    // A manual link saved while this run was searching wins.
    await this.database
      .insertInto("import_book_links")
      .values(row)
      .onConflict((oc) =>
        oc
          .columns(["source", "external_id"])
          .doUpdateSet(row)
          .where("import_book_links.method", "not in", USER_METHODS),
      )
      .execute();
    this.saved?.set(book.externalId, row);
  }
}

export async function listBookLinks(
  database: Kysely<Database>,
  source: BookLinkSource,
): Promise<ImportBookLink[]> {
  const rows = await database
    .selectFrom("import_book_links")
    .selectAll()
    .where("source", "=", source)
    .orderBy("title")
    .execute();
  return rows.map(publicBookLink);
}

/** Records a user choice for a book an import has already seen. */
export async function setBookLink(
  database: Kysely<Database>,
  source: BookLinkSource,
  externalId: string,
  goodreadsId: number | null,
): Promise<ImportBookLink | null> {
  const row = await database
    .updateTable("import_book_links")
    .set({
      goodreads_id: goodreadsId,
      method: goodreadsId === null ? "ignored" : "manual",
      checked_at: Date.now(),
    })
    .where("source", "=", source)
    .where("external_id", "=", externalId)
    .returningAll()
    .executeTakeFirst();
  return row ? publicBookLink(row) : null;
}

/** Forgets a match so the next import matches the book automatically again. */
export async function resetBookLink(
  database: Kysely<Database>,
  source: BookLinkSource,
  externalId: string,
): Promise<boolean> {
  const result = await database
    .deleteFrom("import_book_links")
    .where("source", "=", source)
    .where("external_id", "=", externalId)
    .executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}
