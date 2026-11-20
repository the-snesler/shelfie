import type { CastMember, MediaVideo } from "@shelfie/shared";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import IconChevronLeft from "~icons/tabler/chevron-left";
import IconChevronRight from "~icons/tabler/chevron-right";
import IconPlayerPlayFilled from "~icons/tabler/player-play-filled";
import IconUser from "~icons/tabler/user";
import { tmdbImageUrl } from "../../images";

/**
 * A titled, horizontally scrolling strip of cards — the detail pages' unit
 * for cast, episodes, videos and screenshots.
 */
export function Rail({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  /** Small muted figure after the title, e.g. a total. */
  count?: ReactNode;
  /** Controls right-aligned in the header row. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <RailHeader title={title} count={count} actions={actions} />
      <RailScroller>{children}</RailScroller>
    </section>
  );
}

export function RailHeader({
  title,
  count,
  actions,
}: {
  title: string;
  count?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2">
      <h3 className="font-display text-lg font-medium text-ink">{title}</h3>
      {count != null && (
        <span className="text-sm text-faint tabular-nums">{count}</span>
      )}
      {actions && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * The scrolling part of a rail. Scrolls natively (touch, trackpad,
 * shift+wheel); on pointer devices, edge buttons page it by most of its
 * width and hide when there is nothing further that way.
 */
export function RailScroller({
  scrollerRef,
  children,
}: {
  /** Exposes the scroll container (e.g. to scroll a card into view). */
  scrollerRef?: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft <= 1;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setEdges((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
    );
  }, []);

  // Cards have fixed widths, so the content width only changes when the
  // children do (any render) and the viewport width when the container
  // resizes. Re-measuring per render is two layout reads.
  useEffect(update);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update]);

  const page = (direction: 1 | -1) => {
    const el = ref.current;
    if (el)
      el.scrollBy({
        left: direction * el.clientWidth * 0.8,
        behavior: "smooth",
      });
  };

  return (
    <div className="group/rail relative">
      <div
        ref={(el) => {
          ref.current = el;
          scrollerRef?.(el);
        }}
        onScroll={update}
        className="-mx-1 flex snap-x scroll-px-1 gap-3 overflow-x-auto px-1 pt-1 pb-3 [scrollbar-width:thin]"
      >
        {children}
      </div>
      {!edges.start && <RailButton side="start" onClick={() => page(-1)} />}
      {!edges.end && <RailButton side="end" onClick={() => page(1)} />}
    </div>
  );
}

function RailButton({
  side,
  onClick,
}: {
  side: "start" | "end";
  onClick: () => void;
}) {
  const Icon = side === "start" ? IconChevronLeft : IconChevronRight;
  return (
    <button
      type="button"
      aria-label={side === "start" ? "Scroll back" : "Scroll forward"}
      onClick={onClick}
      className={`absolute top-1/3 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border border-divider bg-panel/90 text-ink opacity-0 shadow-lg backdrop-blur transition-opacity group-hover/rail:opacity-100 focus-visible:opacity-100 pointer-fine:flex ${
        side === "start" ? "-left-3" : "-right-3"
      }`}
    >
      <Icon className="size-5" />
    </button>
  );
}

/** One cast credit: a 2:3 headshot (initials-free silhouette fallback),
 *  the actor's name and their role. */
export function CastCard({ member }: { member: CastMember }) {
  return (
    <div className="flex w-24 shrink-0 snap-start flex-col gap-1.5">
      <div className="aspect-[2/3] w-full overflow-hidden rounded-md bg-well ring-1 ring-divider">
        {member.profilePath ? (
          <img
            loading="lazy"
            src={tmdbImageUrl(member.profilePath, "w185")}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-faint">
            <IconUser className="size-8" />
          </div>
        )}
      </div>
      <div className="min-w-0 text-xs leading-snug">
        <p className="truncate font-medium text-ink" title={member.name}>
          {member.name}
        </p>
        {member.character && (
          <p className="line-clamp-2 text-faint" title={member.character}>
            {member.character}
          </p>
        )}
      </div>
    </div>
  );
}

export function CastRail({ cast }: { cast: readonly CastMember[] }) {
  if (cast.length === 0) return null;
  return (
    <Rail title="Cast" count={cast.length}>
      {cast.map((member, index) => (
        <CastCard key={`${member.name}:${index}`} member={member} />
      ))}
    </Rail>
  );
}

/** YouTube trailers as thumbnail cards, opening on YouTube. */
export function VideoRail({ videos }: { videos: readonly MediaVideo[] }) {
  if (videos.length === 0) return null;
  return (
    <Rail title="Videos" count={videos.length > 1 ? videos.length : undefined}>
      {videos.map((video) => (
        <a
          key={video.videoId}
          target="_blank"
          rel="noreferrer"
          href={`https://www.youtube.com/watch?v=${video.videoId}`}
          className="group flex w-56 shrink-0 snap-start flex-col gap-1.5"
        >
          <div className="relative aspect-video overflow-hidden rounded-md bg-well ring-1 ring-divider group-hover:ring-accent">
            <img
              loading="lazy"
              src={`https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`}
              alt=""
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/40">
              <IconPlayerPlayFilled className="size-8 text-white/90 drop-shadow" />
            </span>
          </div>
          <p className="line-clamp-2 text-xs text-ink">
            {video.name ?? "Trailer"}
          </p>
        </a>
      ))}
    </Rail>
  );
}
