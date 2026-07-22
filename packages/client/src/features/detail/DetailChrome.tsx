import { Children, type ReactNode } from "react";
import IconArrowLeft from "~icons/tabler/arrow-left";
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6 md:px-8">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 self-start rounded text-sm text-muted hover:text-ink"
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

/** Full-width backdrop band that the hero overlaps. Always renders at
 *  aspect-video — including with `src` null while loading — so the cover's
 *  view-transition target position never shifts when metadata lands. */
export function DetailBackdrop({ src }: { src: string | null }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-well">
      {src && (
        <img
          loading="lazy"
          src={src}
          alt=""
          className="h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-bg to-transparent" />
    </div>
  );
}

/** Cover + title/meta block. `overlap` pulls it up over a DetailBackdrop
 *  rendered immediately before it. */
export function DetailHero({
  cover,
  name,
  tagline,
  lines = [],
  overlap = false,
  children,
}: {
  cover: ReactNode;
  name: string | null;
  tagline?: string | null;
  lines?: readonly (string | null | false | undefined)[];
  overlap?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={
        overlap
          ? "relative z-10 -mt-28 flex items-end gap-5 px-2 md:px-4"
          : "flex items-start gap-5"
      }
    >
      <div className="shrink-0">{cover}</div>
      <div className="flex min-w-0 flex-col gap-1 pb-1">
        {name && (
          <h2 className="font-display text-2xl font-semibold tracking-tight text-balance text-ink md:text-3xl">
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

export function Description({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-[70ch] text-sm leading-relaxed text-ink">{children}</p>
  );
}

export function DetailCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-divider bg-panel/70 p-4 text-sm">
      {children}
    </div>
  );
}

export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="text-right text-ink">{children}</span>
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
        Back to library
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
