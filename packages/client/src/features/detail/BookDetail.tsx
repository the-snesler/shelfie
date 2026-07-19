import type { BookDetail as BookDetailDto, LibraryItem } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router";
import type { AppOutletContext } from "../../App";
import type { Route } from "./+types/BookDetail";
import { authFetch } from "../../auth";
import { upsertBookCards } from "../../db/bookCards";
import {
  MediaCover,
  MEDIA_DETAIL_COVER_WIDTH,
  mediaCoverTransitionName,
} from "../media/MediaCover";
import { StatusControl } from "../media/StatusControl";

type MetaState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; meta: BookDetailDto };

export default function BookDetail({ params }: Route.ComponentProps) {
  const { db } = useOutletContext<AppOutletContext>();
  const id = params.id;
  const navigate = useNavigate();
  const location = useLocation();
  const [metaState, setMetaState] = useState<MetaState>({ status: "loading" });
  const [item, setItem] = useState<RxDocument<LibraryItem> | null | undefined>(
    undefined,
  );

  useEffect(() => {
    setMetaState({ status: "loading" });
    let active = true;
    void authFetch(`/api/books/by-id/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (!active) return;
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const meta = (await res.json()) as BookDetailDto;
        setMetaState({ status: "loaded", meta });
        void upsertBookCards(db, [meta]);
      })
      .catch(() => {
        if (active) setMetaState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [db, id]);

  const goodreadsId =
    metaState.status === "loaded" ? metaState.meta.goodreadsId : null;
  useEffect(() => {
    if (goodreadsId === null) {
      setItem(undefined);
      return;
    }
    const sub = db.library_items
      .findOne(`book:${goodreadsId}`)
      .$.subscribe((doc) => {
        setItem(doc ?? null);
      });
    return () => sub.unsubscribe();
  }, [db, goodreadsId]);

  function handleBack() {
    if (location.key !== "default") navigate(-1);
    else navigate("/", { viewTransition: true });
  }

  if (metaState.status === "loading") {
    const linkState = location.state as {
      coverUrl?: string | null;
      name?: string;
    } | null;
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <button
          type="button"
          onClick={handleBack}
          className="self-start text-sm text-muted hover:text-ink"
        >
          ← Back
        </button>
        <div className="flex gap-4">
          <div className="shrink-0">
            <MediaCover
              coverUrl={linkState?.coverUrl ?? null}
              name={linkState?.name ?? "Loading…"}
              width={MEDIA_DETAIL_COVER_WIDTH}
              mediaType="book"
              viewTransitionName={mediaCoverTransitionName("book", id)}
            />
          </div>
          {linkState?.name && (
            <h2 className="text-xl font-semibold text-ink">{linkState.name}</h2>
          )}
        </div>
      </div>
    );
  }

  if (metaState.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-muted">
        <p>Book not found.</p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="text-accent underline"
        >
          Back to library
        </button>
      </div>
    );
  }

  const meta = metaState.meta;
  const detailRows = [
    meta.publisher && { label: "Publisher", value: meta.publisher },
    meta.publicationDate && { label: "Published", value: meta.publicationDate },
    meta.isbn13 && { label: "ISBN-13", value: meta.isbn13 },
    meta.language && { label: "Language", value: meta.language },
  ].filter((row): row is { label: string; value: string } => Boolean(row));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <button
        type="button"
        onClick={handleBack}
        className="self-start text-sm text-muted hover:text-ink"
      >
        ← Back
      </button>
      <div className="flex gap-4">
        <div className="shrink-0">
          <MediaCover
            coverUrl={meta.coverUrl}
            name={meta.name}
            width={MEDIA_DETAIL_COVER_WIDTH}
            mediaType="book"
            viewTransitionName={mediaCoverTransitionName("book", id)}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-xl font-semibold text-ink">{meta.name}</h2>
          {meta.authors.length > 0 && (
            <p className="text-sm text-muted">{meta.authors.join(", ")}</p>
          )}
          {meta.series && (
            <p className="text-sm text-muted">
              {meta.series.name}
              {meta.series.position && ` #${meta.series.position}`}
            </p>
          )}
          {meta.year != null && (
            <p className="text-sm text-muted">{meta.year}</p>
          )}
          {meta.pageCount != null && (
            <p className="text-sm text-muted">{meta.pageCount} pages</p>
          )}
          {meta.genres.length > 0 && (
            <p className="text-sm text-muted">{meta.genres.join(", ")}</p>
          )}
        </div>
      </div>
      {(meta.avgRating != null || (meta.ratingsCount ?? 0) > 0) && (
        <div className="flex flex-wrap gap-2">
          {meta.avgRating != null && (
            <span className="rounded bg-bg px-2 py-1 text-xs ring-1 ring-divider">
              Goodreads {meta.avgRating.toFixed(2)}
              {(meta.ratingsCount ?? 0) > 0 && ` (${meta.ratingsCount})`}
            </span>
          )}
        </div>
      )}
      <StatusControl
        db={db}
        target={{
          mediaType: "book",
          sourceId: String(meta.goodreadsId),
          name: meta.name,
          platforms: [],
        }}
        item={item}
      />
      {meta.description && (
        <p className="text-sm text-ink">{meta.description}</p>
      )}
      {detailRows.length > 0 && (
        <div className="flex flex-col gap-2 rounded border border-divider bg-panel p-4 text-sm">
          {detailRows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <span className="text-muted">{row.label}</span>
              <span className="text-right text-ink">{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
