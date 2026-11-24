import type { LibraryItem, MediaType } from "@shelfie/shared";
import type { BookCardDoc } from "../../db/bookCards";
import type { GameCardDoc } from "../../db/gameCards";
import type { MovieCardDoc } from "../../db/movieCards";
import type { TvCardDoc } from "../../db/tvCards";
import { gameImageUrl, tmdbImageUrl } from "../../images";
import type { DetailLinkState } from "../detail/DetailScreen";
import { selectGameCase } from "../games/platforms";
import type { CardMeta } from "./useLibraryData";

/** Route path segment (without the leading slash) each non-game media type
 *  lives under, e.g. tv -> "tv", movie -> "movies". */
const HREF_SEGMENTS: Record<Exclude<MediaType, "game">, string> = {
  movie: "movies",
  tv: "tv",
  book: "books",
};

export interface LibraryItemLink {
  /** Detail route, or null for a game whose card (and so slug) isn't cached. */
  href: string | null;
  name: string;
  coverUrl: string | null;
  /** Game case template key; null for other media. */
  caseKey: string | null;
  /** Router state the detail screen paints its cover from while loading. */
  state: DetailLinkState;
}

/** Where a library card links and what it hands the detail page, shared by
 *  the card itself and anything that navigates on its behalf (the planned
 *  shelf's random pick), so both get the same cover view transition. */
export function libraryItemLink(
  item: Pick<
    LibraryItem,
    "mediaType" | "sourceId" | "platforms" | "storefront"
  >,
  meta: CardMeta | undefined,
): LibraryItemLink {
  const gameMeta =
    item.mediaType === "game" ? (meta as GameCardDoc | undefined) : undefined;
  const movieMeta =
    item.mediaType === "movie" ? (meta as MovieCardDoc | undefined) : undefined;
  const tvMeta =
    item.mediaType === "tv" ? (meta as TvCardDoc | undefined) : undefined;
  const bookMeta =
    item.mediaType === "book" ? (meta as BookCardDoc | undefined) : undefined;
  const posterMeta = movieMeta ?? tvMeta;

  const name =
    gameMeta?.name ??
    movieMeta?.name ??
    tvMeta?.name ??
    bookMeta?.name ??
    item.sourceId;

  const href =
    item.mediaType === "game"
      ? gameMeta?.slug
        ? `/games/${encodeURIComponent(gameMeta.slug)}`
        : null
      : `/${HREF_SEGMENTS[item.mediaType]}/${encodeURIComponent(item.sourceId)}`;

  const caseKey =
    item.mediaType === "game"
      ? selectGameCase(
          item.platforms,
          gameMeta?.platforms ?? [],
          gameMeta?.platformReleaseDates ?? [],
          item.storefront,
        )
      : null;

  const coverUrl =
    item.mediaType === "game"
      ? gameMeta?.coverImageId
        ? gameImageUrl("t_cover_big", gameMeta.coverImageId)
        : null
      : item.mediaType === "book"
        ? (bookMeta?.coverUrl ?? null)
        : posterMeta?.posterPath
          ? tmdbImageUrl(posterMeta.posterPath, "w342")
          : null;

  return {
    href,
    name,
    coverUrl,
    caseKey,
    state: { coverUrl, coverHash: meta?.coverHash, caseKey, name },
  };
}
