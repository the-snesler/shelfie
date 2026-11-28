import type { BookDetail as BookDetailDto } from "@tsundo/shared";
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
import { formatIsoDay } from "../media/dates";
import { ExpandableText } from "./DetailChrome";

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
        const series =
          meta.series &&
          `${meta.series.name}${
            meta.series.position ? ` #${meta.series.position}` : ""
          }`;
        return {
          name: meta.name,
          coverUrl: meta.coverUrl,
          lines: [
            meta.authors.length > 0 && meta.authors.join(", "),
            [
              yearOf(meta.publicationDate),
              meta.pageCount != null && `${meta.pageCount} pages`,
              series,
            ]
              .filter(Boolean)
              .join(" · "),
            meta.genres.length > 0 && meta.genres.slice(0, 5).join(", "),
          ],
          pills: [
            meta.avgRating != null &&
              `Goodreads ${meta.avgRating.toFixed(2)}${
                (meta.ratingsCount ?? 0) > 0
                  ? ` · ${meta.ratingsCount!.toLocaleString()}`
                  : ""
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
          about: meta.description && (
            <ExpandableText>
              <p className="whitespace-pre-line">{meta.description}</p>
            </ExpandableText>
          ),
          facts: [
            { label: "Series", value: series },
            { label: "Published", value: formatIsoDay(meta.publicationDate) },
            { label: "Publisher", value: meta.publisher },
            meta.pageCount != null && {
              label: "Pages",
              value: String(meta.pageCount),
            },
            { label: "ISBN-13", value: meta.isbn13 },
            { label: "Language", value: meta.language },
          ],
          links: [
            {
              label: "Goodreads",
              href: `https://www.goodreads.com/book/show/${meta.goodreadsId}`,
            },
            meta.isbn13 && {
              label: "Open Library",
              href: `https://openlibrary.org/isbn/${meta.isbn13}`,
            },
          ],
        };
      }}
    />
  );
}
