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
import {
  Description,
  DetailCard,
  DetailHero,
  DetailPage,
  DetailRow,
  DetailSection,
  NotFound,
  RatingPills,
} from "./DetailChrome";

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
      <DetailPage onBack={handleBack}>
        <DetailHero
          name={linkState?.name ?? null}
          cover={
            <MediaCover
              coverUrl={linkState?.coverUrl ?? null}
              name={linkState?.name ?? "Loading…"}
              width={MEDIA_DETAIL_COVER_WIDTH}
              mediaType="book"
              viewTransitionName={mediaCoverTransitionName("book", id)}
            />
          }
        />
      </DetailPage>
    );
  }

  if (metaState.status === "error") {
    return <NotFound message="Book not found" onBack={() => navigate("/")} />;
  }

  const meta = metaState.meta;
  const detailRows = [
    meta.publisher && { label: "Publisher", value: meta.publisher },
    meta.publicationDate && { label: "Published", value: meta.publicationDate },
    meta.isbn13 && { label: "ISBN-13", value: meta.isbn13 },
    meta.language && { label: "Language", value: meta.language },
  ].filter((row): row is { label: string; value: string } => Boolean(row));

  return (
    <DetailPage onBack={handleBack}>
      <DetailHero
        name={meta.name}
        lines={[
          meta.authors.length > 0 && meta.authors.join(", "),
          meta.series &&
            `${meta.series.name}${
              meta.series.position ? ` #${meta.series.position}` : ""
            }`,
          [meta.year, meta.pageCount != null && `${meta.pageCount} pages`]
            .filter(Boolean)
            .join(" · "),
          meta.genres.length > 0 && meta.genres.join(", "),
        ]}
        cover={
          <MediaCover
            coverUrl={meta.coverUrl}
            name={meta.name}
            width={MEDIA_DETAIL_COVER_WIDTH}
            mediaType="book"
            viewTransitionName={mediaCoverTransitionName("book", id)}
          />
        }
      >
        <div className="mt-2 flex flex-col items-start gap-3">
          <RatingPills
            pills={[
              meta.avgRating != null &&
                `Goodreads ${meta.avgRating.toFixed(2)}${
                  (meta.ratingsCount ?? 0) > 0 ? ` (${meta.ratingsCount})` : ""
                }`,
            ]}
          />
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
        </div>
      </DetailHero>
      {meta.description && <Description>{meta.description}</Description>}
      {detailRows.length > 0 && (
        <DetailSection title="Details">
          <DetailCard>
            {detailRows.map((row) => (
              <DetailRow key={row.label} label={row.label}>
                {row.value}
              </DetailRow>
            ))}
          </DetailCard>
        </DetailSection>
      )}
    </DetailPage>
  );
}
