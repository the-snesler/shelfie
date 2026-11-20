import type { BookDetail as BookDetailDto } from "@shelfie/shared";
import { useOutletContext } from "react-router";
import type { AppOutletContext } from "../../App";
import type { Route } from "./+types/BookDetail";
import { upsertBookCards } from "../../db/bookCards";
import {
  MediaCover,
  MEDIA_DETAIL_COVER_WIDTH,
  mediaCoverTransitionName,
} from "../media/MediaCover";
import { yearOf } from "../media/libraryActions";
import { StatusControl } from "../media/StatusControl";
import { useDetailFetch } from "./useDetailFetch";
import { DetailScreen } from "./DetailScreen";
import {
  Description,
  DetailCard,
  DetailRow,
  DetailSection,
} from "./DetailChrome";

export default function BookDetail({ params }: Route.ComponentProps) {
  const { db } = useOutletContext<AppOutletContext>();
  const id = params.id;
  const { metaState, item } = useDetailFetch<BookDetailDto>({
    db,
    url: `/api/books/by-id/${encodeURIComponent(id)}`,
    libraryItemId: (meta) => `book:${meta.goodreadsId}`,
    upsertCards: upsertBookCards,
  });

  return (
    <DetailScreen
      state={metaState}
      item={item}
      notFoundMessage="Book not found"
      cover={(meta, link) => (
        <MediaCover
          coverUrl={meta ? meta.coverUrl : (link?.coverUrl ?? null)}
          coverHash={meta ? meta.coverHash : link?.coverHash}
          name={meta?.name ?? link?.name ?? "Loading…"}
          width={MEDIA_DETAIL_COVER_WIDTH}
          mediaType="book"
          viewTransitionName={mediaCoverTransitionName("book", id)}
        />
      )}
      render={(meta) => {
        const detailRows = [
          meta.publisher && { label: "Publisher", value: meta.publisher },
          meta.publicationDate && {
            label: "Published",
            value: meta.publicationDate,
          },
          meta.isbn13 && { label: "ISBN-13", value: meta.isbn13 },
          meta.language && { label: "Language", value: meta.language },
        ].filter((row): row is { label: string; value: string } =>
          Boolean(row),
        );

        return {
          name: meta.name,
          lines: [
            meta.authors.length > 0 && meta.authors.join(", "),
            meta.series &&
              `${meta.series.name}${
                meta.series.position ? ` #${meta.series.position}` : ""
              }`,
            [
              yearOf(meta.publicationDate),
              meta.pageCount != null && `${meta.pageCount} pages`,
            ]
              .filter(Boolean)
              .join(" · "),
            meta.genres.length > 0 && meta.genres.join(", "),
          ],
          pills: [
            meta.avgRating != null &&
              `Goodreads ${meta.avgRating.toFixed(2)}${
                (meta.ratingsCount ?? 0) > 0 ? ` (${meta.ratingsCount})` : ""
              }`,
          ],
          status: (
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
          ),
          body: (
            <>
              {meta.description && (
                <Description>{meta.description}</Description>
              )}
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
            </>
          ),
        };
      }}
    />
  );
}
