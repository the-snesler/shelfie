import type { LibraryItem } from "@shelfie/shared";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import type { RxDocument } from "rxdb";
import {
  DetailBackdrop,
  DetailBodySkeleton,
  DetailHero,
  DetailPage,
  NotFound,
  RatingPills,
} from "./DetailChrome";
import { MyActivity } from "./MyActivity";
import { useBackNavigation } from "./useBackNavigation";
import type { DetailFetchState } from "./useDetailFetch";

/** Minimal cover data passed via `<Link state>` from the library/search
 *  cards that navigate to a detail page, so the first paint (before the
 *  detail fetch resolves) already has a cover box on-screen — a view
 *  transition can only pair a `view-transition-name` across old/new
 *  snapshots if the named element is actually present in the DOM when each
 *  snapshot is taken. `platform` is game-only. */
export interface DetailLinkState {
  coverUrl?: string | null;
  coverHash?: string | null;
  platform?: string | null;
  name?: string;
}

type Line = string | null | false | undefined;

/** What a loaded detail screen contributes to the shared frame. */
export interface DetailSlots {
  name: string;
  tagline?: string | null;
  lines?: readonly Line[];
  /** Backdrop image URL; only read when the screen opts into a backdrop. */
  backdrop?: string | null;
  pills?: readonly Line[];
  /** The `StatusControl` for this item. */
  status: ReactNode;
  /** Everything below the hero and activity timeline. */
  body?: ReactNode;
}

/**
 * The frame every detail screen shares: the loading placeholder (cover from
 * link state + skeleton), the not-found screen, and the loaded hero with
 * ratings, status control and activity. Screens keep their own fetching and
 * RxDB writes and describe only what differs, through `cover` and `render`.
 */
export function DetailScreen<TMeta>({
  state,
  item,
  notFoundMessage,
  hasBackdrop = false,
  cover,
  render,
}: {
  state: DetailFetchState<TMeta>;
  item: RxDocument<LibraryItem> | null | undefined;
  notFoundMessage: string;
  hasBackdrop?: boolean;
  /** The hero cover; `meta` is null while loading, when only the link
   *  state's cover data is available. */
  cover: (meta: TMeta | null, link: DetailLinkState | null) => ReactNode;
  render: (meta: TMeta) => DetailSlots;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const handleBack = useBackNavigation();

  if (state.status === "error") {
    return (
      <NotFound
        message={state.message ?? notFoundMessage}
        onBack={() => navigate("/")}
      />
    );
  }

  if (state.status === "loading") {
    const link = location.state as DetailLinkState | null;
    return (
      <DetailPage onBack={handleBack}>
        {hasBackdrop && <DetailBackdrop src={null} />}
        <DetailHero
          overlap={hasBackdrop}
          name={link?.name ?? null}
          cover={cover(null, link)}
        />
        <DetailBodySkeleton />
      </DetailPage>
    );
  }

  const slots = render(state.meta);
  return (
    <DetailPage onBack={handleBack}>
      {hasBackdrop && <DetailBackdrop src={slots.backdrop ?? null} />}
      <DetailHero
        overlap={hasBackdrop}
        name={slots.name}
        tagline={slots.tagline}
        lines={slots.lines}
        cover={cover(state.meta, null)}
      >
        <div className="mt-2 flex flex-col items-start gap-3">
          <RatingPills pills={slots.pills ?? []} />
          {slots.status}
        </div>
      </DetailHero>
      <MyActivity item={item} />
      {slots.body}
    </DetailPage>
  );
}
