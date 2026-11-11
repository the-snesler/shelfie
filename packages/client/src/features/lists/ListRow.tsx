import type { LibraryItem, MediaType } from "@shelfie/shared";
import { STATUS_META_GROUP } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect } from "react";
import { Link } from "react-router";
import IconChevronDown from "~icons/tabler/chevron-down";
import { StaticBolts } from "../../components/StaticBolts";
import { StaticStars } from "../../components/StaticStars";
import { TruncatedText } from "../../components/Tooltip";
import type { ShelfieDatabase } from "../../db/database";
import { libraryProgressPercent } from "../library/libraryProgress";
import { lastCompletedDate } from "../library/librarySorting";
import { LogPopover } from "../media/LogPopover";
import { itemLogTarget } from "../media/logTarget";
import { MediaCover } from "../media/MediaCover";
import { itemReleaseDate } from "../media/release";
import { STATUS_ICONS, STATUS_LABELS } from "../media/status";
import type { CardMeta } from "../media/useLibraryData";
import { cardCover, cardName, detailHref } from "../media/useLibraryData";
import { useLogPopover } from "../media/useLogPopover";

const MEDIA_LABEL: Record<MediaType, string> = {
  game: "Game",
  movie: "Movie",
  tv: "TV",
  book: "Book",
};

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function epochDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const COLUMNS =
  "grid grid-cols-[40px_minmax(0,1fr)_128px] items-center gap-x-3 sm:grid-cols-[40px_minmax(0,1fr)_128px_88px] md:grid-cols-[40px_minmax(0,1fr)_128px_88px_48px] lg:grid-cols-[40px_minmax(0,1fr)_128px_88px_48px_104px_104px]";

/** `planned`: every row below is planned, so the rating column only shows
 *  excitement and is titled for it. */
export function ListHeaderRow({ planned }: { planned: boolean }) {
  return (
    <div
      className={`${COLUMNS} border-b border-divider px-3 pb-2 text-[11px] font-medium tracking-wide text-faint uppercase`}
      aria-hidden
    >
      <span />
      <span>Title</span>
      <span>Status</span>
      <span className="hidden sm:block">
        {planned ? "Excitement" : "Rating"}
      </span>
      <span className="hidden text-right md:block">Progress</span>
      <span className="hidden text-right lg:block">Last finished</span>
      <span className="hidden text-right lg:block">Added</span>
    </div>
  );
}

/** One list-view row. The status pill opens the same log popover as a
 *  shelf card's `+`, so status, rating, and dates are editable in place. */
export function ListRow({
  db,
  item,
  meta,
  onLogOpenChange,
}: {
  db: ShelfieDatabase;
  item: RxDocument<LibraryItem>;
  meta: CardMeta | undefined;
  onLogOpenChange: (itemId: string, open: boolean) => void;
}) {
  const popover = useLogPopover();
  useEffect(() => {
    onLogOpenChange(item.id, popover.open);
  }, [onLogOpenChange, item.id, popover.open]);

  const name = cardName(item, meta);
  const href = detailHref(item, meta);
  const year = itemReleaseDate(item, meta)?.slice(0, 4);
  // Only the platforms the user logged — a card's full platform list is noise.
  const platforms = item.mediaType === "game" ? item.platforms : [];
  const subtitle = [MEDIA_LABEL[item.mediaType], year, platforms.join(", ")]
    .filter(Boolean)
    .join(" · ");
  const progress = libraryProgressPercent(item, meta);
  const finished = lastCompletedDate(item);
  const StatusIcon = STATUS_ICONS[item.status];

  const cover = (
    <MediaCover
      coverUrl={cardCover(item.mediaType, meta)}
      name={name}
      width={40}
      mediaType={item.mediaType}
    />
  );

  return (
    <div className={`${COLUMNS} rounded-md px-3 py-2 hover:bg-well/60`}>
      {href ? (
        <Link to={href} tabIndex={-1} aria-hidden>
          {cover}
        </Link>
      ) : (
        <div className="opacity-60">{cover}</div>
      )}
      <div className="min-w-0">
        {href ? (
          <Link to={href} className="block hover:text-accent">
            <TruncatedText as="p" className="text-sm font-medium text-ink">
              {name}
            </TruncatedText>
          </Link>
        ) : (
          <TruncatedText as="p" className="text-sm font-medium text-ink">
            {name}
          </TruncatedText>
        )}
        <TruncatedText as="p" className="text-xs text-muted">
          {subtitle}
        </TruncatedText>
      </div>
      <button
        type="button"
        ref={popover.refs.setReference}
        {...popover.getReferenceProps()}
        onClick={() => popover.setOpen(true)}
        aria-label={`Edit ${name}: ${STATUS_LABELS[item.mediaType][item.status]}`}
        className="inline-flex items-center gap-1.5 justify-self-start rounded-md border border-divider bg-well px-2 py-1 text-xs whitespace-nowrap text-ink hover:border-accent"
      >
        <StatusIcon className="size-3.5 text-accent" />
        {STATUS_LABELS[item.mediaType][item.status]}
        <IconChevronDown className="size-3 text-faint" />
      </button>
      {/* One slot, as in the log popup: planned titles show their
          excitement here, everything else its rating. */}
      <div className="hidden sm:block">
        {STATUS_META_GROUP[item.status] === "planned" ? (
          item.excitement != null ? (
            <StaticBolts value={item.excitement} />
          ) : (
            <span className="text-xs text-faint">—</span>
          )
        ) : item.rating != null ? (
          <StaticStars value={item.rating} />
        ) : (
          <span className="text-xs text-faint">—</span>
        )}
      </div>
      <span className="hidden text-right text-xs text-muted tabular-nums md:block">
        {progress != null ? `${Math.round(progress)}%` : "—"}
      </span>
      <span className="hidden text-right text-xs text-muted tabular-nums lg:block">
        {finished ? shortDate(finished) : "—"}
      </span>
      <span className="hidden text-right text-xs text-muted tabular-nums lg:block">
        {epochDate(item.addedAt)}
      </span>
      <LogPopover
        popover={popover}
        db={db}
        target={itemLogTarget(item, meta)}
        item={item}
      />
    </div>
  );
}
