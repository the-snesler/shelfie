import type { BookDetail as BookDetailDto } from "@shelfie/shared";
import { useLocation, useNavigate, useOutletContext } from "react-router";
import type { AppOutletContext } from "../../App";
import type { Route } from "./+types/BookDetail";
import { upsertBookCards } from "../../db/bookCards";
import {
  MediaCover,
  MEDIA_DETAIL_COVER_WIDTH,
  mediaCoverTransitionName,
} from "../media/MediaCover";
import { StatusControl } from "../media/StatusControl";
import { useBackNavigation } from "./useBackNavigation";
import { useDetailFetch } from "./useDetailFetch";
import {
  Description,
  DetailBodySkeleton,
  DetailCard,
  DetailHero,
  DetailPage,
  DetailRow,
  DetailSection,
  NotFound,
  RatingPills,
} from "./DetailChrome";

export default function BookDetail({ params }: Route.ComponentProps) {
  const { db } = useOutletContext<AppOutletContext>();
  const id = params.id;
  const navigate = useNavigate();
  const location = useLocation();
  const { metaState, item } = useDetailFetch<BookDetailDto>({
    db,
    url: `/api/books/by-id/${encodeURIComponent(id)}`,
    libraryItemId: (meta) => `book:${meta.goodreadsId}`,
    upsertCards: upsertBookCards,
  });
  const handleBack = useBackNavigation();

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
        <DetailBodySkeleton />
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
              releaseDate: meta.publicationDate,
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
