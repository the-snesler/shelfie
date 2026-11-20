import {
  Children,
  Fragment,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import IconArrowLeft from "~icons/tabler/arrow-left";
import IconArrowUpRight from "~icons/tabler/arrow-up-right";
import IconPlayerPlay from "~icons/tabler/player-play";

/** Shared presentational chrome for the four detail screens. Purely visual —
 *  data fetching, RxDB subscriptions, and view-transition wiring stay in each
 *  screen. */

export function DetailPage({
  onBack,
  children,
}: {
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-6 md:px-8">
      <button
        type="button"
        onClick={onBack}
        className="relative z-10 flex items-center gap-1.5 self-start rounded text-sm text-muted hover:text-ink"
      >
        <IconArrowLeft className="size-4" />
        Back
      </button>
      {/* Normalize the loading and loaded child shapes. React otherwise
          remounts a lone hero when detail sections are appended, which
          cancels its in-flight named view transition. */}
      {Children.toArray(children)}
    </div>
  );
}

/** Backdrop band the hero sits on, absolutely positioned behind it. With no
 *  backdrop image it paints the cover itself, heavily blurred, so every
 *  medium (and the loading state) gets the same frame. The band has a fixed
 *  height either way, so the cover's view-transition target never shifts
 *  when metadata lands. */
export function DetailBackdrop({
  src,
  blurSrc,
}: {
  src: string | null;
  blurSrc?: string | null;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 -top-14 h-80 overflow-hidden rounded-xl bg-well/40 md:h-[26rem]"
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover object-[50%_25%] opacity-80"
        />
      ) : (
        blurSrc && (
          <img
            src={blurSrc}
            alt=""
            className="h-full w-full scale-125 object-cover opacity-60 blur-3xl saturate-150"
          />
        )
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/10" />
      <div className="absolute inset-0 hidden bg-gradient-to-r from-bg/70 via-transparent to-transparent lg:block" />
    </div>
  );
}

/**
 * The hero: cover, title block, then the description and a facts sidebar.
 * Phones stack it as cover+title, description, sidebar; wide screens put
 * the sidebar in a third column and the description under the title, next
 * to the cover. The cover is always top-aligned at a fixed offset so its
 * view-transition position is the same while loading and once loaded.
 */
export function DetailHero({
  cover,
  backdrop,
  name,
  tagline,
  lines = [],
  actions,
  about,
  sidebar,
  children,
}: {
  cover: ReactNode;
  backdrop: ReactNode;
  name: string | null;
  tagline?: string | null;
  lines?: readonly (string | null | false | undefined)[];
  /** The action row (status control etc.); full width under the cover on
   *  phones, under the title on wide screens. */
  actions?: ReactNode;
  about?: ReactNode;
  sidebar?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative">
      {backdrop}
      <div className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-5 pt-20 [grid-template-areas:'cover_title''actions_actions''about_about''side_side'] md:pt-32 lg:grid-cols-[auto_minmax(0,1fr)_17rem] lg:grid-rows-[auto_auto_1fr] lg:gap-y-4 lg:[grid-template-areas:'cover_title_side''cover_actions_side''cover_about_side']">
        <div className="self-start [grid-area:cover]">{cover}</div>
        <div className="flex min-w-0 flex-col gap-1 self-end [grid-area:title] lg:self-start">
          {name && (
            <h2 className="font-display text-2xl font-semibold tracking-tight text-balance text-ink md:text-4xl">
              {name}
            </h2>
          )}
          {tagline && <p className="text-sm text-muted italic">{tagline}</p>}
          {lines
            .filter((line): line is string => Boolean(line))
            .map((line, i) => (
              <p key={i} className="text-sm text-muted">
                {line}
              </p>
            ))}
          {children}
        </div>
        {actions && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 [grid-area:actions]">
            {actions}
          </div>
        )}
        {about && <div className="min-w-0 [grid-area:about]">{about}</div>}
        {sidebar && (
          <div className="min-w-0 self-start [grid-area:side]">{sidebar}</div>
        )}
      </div>
    </div>
  );
}

export function RatingPills({
  pills,
}: {
  pills: readonly (string | null | false | undefined)[];
}) {
  const shown = pills.filter((pill): pill is string => Boolean(pill));
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {shown.map((pill) => (
        <span
          key={pill}
          className="rounded-full bg-well px-2.5 py-1 text-xs text-muted ring-1 ring-divider"
        >
          {pill}
        </span>
      ))}
    </div>
  );
}

export function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-display text-lg font-medium text-ink">{title}</h3>
      {children}
    </section>
  );
}

export function TrailerChips({
  videos,
}: {
  videos: readonly { videoId: string; name: string | null }[];
}) {
  if (videos.length === 0) return null;
  return (
    <DetailSection title="Videos">
      <div className="flex flex-wrap gap-2">
        {videos.map((video) => (
          <a
            key={video.videoId}
            target="_blank"
            rel="noreferrer"
            href={`https://www.youtube.com/watch?v=${video.videoId}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-well px-3 py-1.5 text-xs font-medium text-ink ring-1 ring-divider hover:ring-accent"
          >
            <IconPlayerPlay className="size-3.5 text-accent" />
            {video.name ?? "Trailer"}
          </a>
        ))}
      </div>
    </DetailSection>
  );
}

export interface DetailFact {
  label: string;
  value: ReactNode;
}

export interface DetailLink {
  label: string;
  href: string;
}

/** Placeholder entries callers may leave in a facts/links list, so they can
 *  write `cond && { ... }` inline; dropped before rendering. */
export type Omitted = null | undefined | false | "";

/** The hero sidebar: a compact key/value list plus external links. Rows
 *  with an empty value are dropped, so callers can list every candidate. */
export function DetailFacts({
  facts,
  links = [],
}: {
  facts: readonly (DetailFact | Omitted)[];
  links?: readonly (DetailLink | Omitted)[];
}) {
  const shownFacts = facts.filter((fact): fact is DetailFact =>
    Boolean(fact && fact.value),
  );
  const shownLinks = links.filter((link): link is DetailLink => Boolean(link));
  if (shownFacts.length === 0 && shownLinks.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-divider bg-panel/80 p-4 text-sm backdrop-blur">
      {shownFacts.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
          {shownFacts.map((fact) => (
            <Fragment key={fact.label}>
              <dt className="text-faint">{fact.label}</dt>
              <dd className="text-right text-ink">{fact.value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {shownLinks.length > 0 && (
        <div
          className={`flex flex-wrap gap-x-3 gap-y-1 ${
            shownFacts.length > 0 ? "border-t border-divider pt-3" : ""
          }`}
        >
          {shownLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline"
            >
              {link.label}
              <IconArrowUpRight className="size-3.5" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** Description block clamped to a few lines with a More/Less toggle. The
 *  toggle only appears when the text actually overflows the clamp. Uses a
 *  max-height + fade mask rather than line-clamp so it can hold several
 *  paragraphs. */
export function ExpandableText({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (!expanded) setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded]);

  const clamped = !expanded;
  return (
    <div className="flex max-w-[70ch] flex-col items-start gap-1">
      <div
        ref={ref}
        className={`flex flex-col gap-2 text-sm leading-relaxed text-ink ${
          clamped ? "max-h-[6.5lh] overflow-hidden" : ""
        }`}
        style={
          clamped && overflows
            ? {
                maskImage:
                  "linear-gradient(to bottom, black 60%, transparent 100%)",
              }
            : undefined
        }
      >
        {children}
      </div>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-medium text-accent hover:underline"
        >
          {expanded ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

export function NotFound({
  message,
  onBack,
}: {
  message: string;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-12 text-muted">
      <p className="font-display text-xl text-ink">{message}</p>
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-medium text-accent hover:underline"
      >
        Back
      </button>
    </div>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-lg bg-well/70 ${className ?? ""}`} />
  );
}

/** Body placeholder rendered under the hero while a detail screen's fetch
 *  is in flight — a description paragraph and a section, roughed in with
 *  pulsing bars so the page reads as loading instead of a bare cover. */
export function DetailBodySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SkeletonBlock className="h-3 w-3/4" />
        <SkeletonBlock className="h-3 w-full" />
        <SkeletonBlock className="h-3 w-5/6" />
        <SkeletonBlock className="h-3 w-2/3" />
      </div>
      <SkeletonBlock className="h-40" />
    </div>
  );
}
