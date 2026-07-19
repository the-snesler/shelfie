import type { MediaType } from "@shelfie/shared";

/** px width of a media (movie/tv/book) cover in the library grid. */
export const MEDIA_LIBRARY_COVER_WIDTH = 120;
/** px width of a media cover in a search result row. */
export const MEDIA_SEARCH_COVER_WIDTH = 48;
/** px width of a media cover on a detail page. */
export const MEDIA_DETAIL_COVER_WIDTH = 180;

/** Shared `view-transition-name` for a movie/tv/book cover, keyed by media
 *  type + source id — the identifiers every surface (library card, search
 *  row, detail route param) has synchronously, so the destination page can
 *  tag its cover box on first paint, before any async fetch resolves
 *  (mirrors `gameCoverTransitionName`, which uses the slug the same way). */
export function mediaCoverTransitionName(
  mediaType: MediaType,
  sourceId: string,
): string {
  return `${mediaType}-cover-${sourceId}`;
}

/** Plain 2:3 poster/cover box for movie/tv/book cards — no case-art overlay
 *  or platform template, unlike `GameCover`. Books get the `.book` spine
 *  treatment from index.css; it supplies its own radius/shadow. Renders a
 *  centered name fallback when there is no cover image. */
export function MediaCover({
  coverUrl,
  name,
  width,
  mediaType,
  viewTransitionName,
}: {
  coverUrl: string | null;
  name: string;
  /** px; height derives from the fixed 2:3 poster aspect ratio. */
  width: number;
  /** Drives per-medium cover chrome (book spine); poster style otherwise. */
  mediaType?: MediaType;
  /** Only set while this cover participates in an active view transition
   *  (source side) or is the detail page's cover (destination side). */
  viewTransitionName?: string;
}) {
  const style = {
    width: `${width}px`,
    aspectRatio: "2 / 3",
    viewTransitionName: viewTransitionName ?? "none",
  } as React.CSSProperties;

  return (
    <div
      className={
        mediaType === "book"
          ? "book relative overflow-hidden bg-panel"
          : "poster relative overflow-hidden rounded bg-panel"
      }
      style={style}
    >
      {coverUrl ? (
        <img
          src={coverUrl}
          alt={name}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-muted">
          {name}
        </div>
      )}
    </div>
  );
}
