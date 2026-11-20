import type { LibraryItem } from "@shelfie/shared";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import type { RxDocument } from "rxdb";
import { StaticStars } from "../../components/StaticStars";
import { ActivityButton } from "./ActivityButton";
import {
  type DetailFact,
  DetailBackdrop,
  DetailBodySkeleton,
  DetailFacts,
  DetailHero,
  type DetailLink,
  DetailPage,
  NotFound,
  type Omitted,
  RatingPills,
} from "./DetailChrome";
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
  /** Wide backdrop image; without one the band paints the blurred cover. */
  backdrop?: string | null;
  /** The cover image URL, for the blurred backdrop fallback. */
  coverUrl: string | null;
  pills?: readonly Line[];
  /** The `StatusControl` for this item. */
  status: ReactNode;
  /** Extra buttons beside the status control (e.g. TV's next episode). */
  actions?: ReactNode;
  /** Description paragraphs, clamped by the hero. */
  about?: ReactNode;
  facts?: readonly (DetailFact | Omitted)[];
  links?: readonly (DetailLink | Omitted)[];
  /** Everything below the hero. */
  body?: ReactNode;
}

/**
 * The frame every detail screen shares: the loading placeholder (cover from
 * link state + skeleton), the not-found screen, and the loaded hero with
 * ratings, actions, description and facts sidebar. Screens keep their own
 * fetching and RxDB writes and describe only what differs, through `cover`
 * and `render`.
 */
export function DetailScreen<TMeta>({
  state,
  item,
  notFoundMessage,
  cover,
  render,
}: {
  state: DetailFetchState<TMeta>;
  item: RxDocument<LibraryItem> | null | undefined;
  notFoundMessage: string;
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
        <DetailHero
          backdrop={
            <DetailBackdrop src={null} blurSrc={link?.coverUrl ?? null} />
          }
          name={link?.name ?? null}
          cover={cover(null, link)}
        />
        <DetailBodySkeleton />
      </DetailPage>
    );
  }

  const slots = render(state.meta);
  const rating = item?.rating ?? null;
  return (
    <DetailPage onBack={handleBack}>
      <DetailHero
        backdrop={
          <DetailBackdrop
            src={slots.backdrop ?? null}
            blurSrc={slots.coverUrl}
          />
        }
        name={slots.name}
        tagline={slots.tagline}
        lines={slots.lines}
        cover={cover(state.meta, null)}
        actions={
          <>
            {slots.status}
            {slots.actions}
            <ActivityButton item={item} />
          </>
        }
        about={slots.about}
        sidebar={
          slots.facts || slots.links ? (
            <DetailFacts facts={slots.facts ?? []} links={slots.links} />
          ) : null
        }
      >
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <RatingPills pills={slots.pills ?? []} />
          {rating !== null && (
            <span className="flex items-center gap-1.5 text-xs text-faint">
              <StaticStars value={rating} />
              yours
            </span>
          )}
        </div>
      </DetailHero>
      {slots.body}
    </DetailPage>
  );
}
