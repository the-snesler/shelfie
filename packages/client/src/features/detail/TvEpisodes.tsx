import type { TvDetail, TvEpisode, TvSeason } from "@tsundo/shared";
import { episodeKey } from "@tsundo/shared";
import { useEffect, useRef, useState } from "react";
import IconCheck from "~icons/tabler/check";
import IconLayoutList from "~icons/tabler/layout-list";
import IconLayoutRows from "~icons/tabler/carousel-horizontal";
import { tmdbImageUrl } from "../../images";
import { formatIsoDayShort } from "../media/dates";
import { formatRuntime } from "../media/duration";
import { RailHeader, RailScroller } from "./Rail";
import {
  episodeProgress,
  isEpisodeAired,
  type NextUp,
  orderedSeasons,
} from "./episodeProgress";

type EpisodeView = "rail" | "list";
const VIEW_STORAGE_KEY = "tsundo:tv-episode-view";

function readView(): EpisodeView {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "rail";
  } catch {
    return "rail";
  }
}

function seasonLabel(season: TvSeason): string {
  return season.seasonNumber === 0
    ? "Specials"
    : season.name || `Season ${season.seasonNumber}`;
}

/**
 * TV detail's episode tracker: aired-vs-watched progress, season tabs, and
 * the selected season as either a rail of still cards or a compact
 * checklist (remembered per browser). Only the selected season renders, so
 * long-running shows stay cheap. Unaired episodes can't be ticked, and the
 * next episode to watch is highlighted and scrolled into view.
 */
export function TvEpisodes({
  meta,
  watched,
  disabled,
  today,
  nextUp,
  onToggle,
  onSetWatched,
}: {
  meta: TvDetail;
  watched: Record<string, string>;
  /** True until the library item lookup settles. */
  disabled: boolean;
  today: string;
  nextUp: NextUp | null;
  onToggle: (episode: TvEpisode) => void;
  onSetWatched: (keys: string[], watched: boolean) => void;
}) {
  const seasons = orderedSeasons(meta.seasons);
  const [selected, setSelected] = useState(
    () => nextUp?.episode.seasonNumber ?? seasons[0]?.seasonNumber ?? 1,
  );
  const [view, setView] = useState<EpisodeView>(readView);
  const scroller = useRef<HTMLDivElement | null>(null);
  const nextKey = nextUp
    ? episodeKey(nextUp.episode.seasonNumber, nextUp.episode.episodeNumber)
    : null;

  // Bring the next episode into view when its season opens.
  useEffect(() => {
    const el = scroller.current;
    const card = el?.querySelector<HTMLElement>('[data-next="true"]');
    if (!el || !card) return;
    el.scrollLeft +=
      card.getBoundingClientRect().left - el.getBoundingClientRect().left - 4;
  }, [selected, view, nextKey]);

  if (seasons.length === 0) return null;
  const season = seasons.find((s) => s.seasonNumber === selected) ?? seasons[0];
  const lastAired = meta.lastEpisodeToAir;
  const progress = episodeProgress(watched, meta);
  const percent =
    progress.aired > 0
      ? Math.min(100, Math.round((progress.watched / progress.aired) * 100))
      : 0;

  const airedKeys = season.episodes
    .filter((ep) => isEpisodeAired(ep, lastAired, today))
    .map((ep) => episodeKey(ep.seasonNumber, ep.episodeNumber));
  const seasonKeys = season.episodes.map((ep) =>
    episodeKey(ep.seasonNumber, ep.episodeNumber),
  );
  const allAiredWatched =
    airedKeys.length > 0 && airedKeys.every((key) => key in watched);

  const changeView = (next: EpisodeView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Private mode or blocked storage: the choice just won't persist.
    }
  };

  const episodes = season.episodes.map((ep) => {
    const key = episodeKey(ep.seasonNumber, ep.episodeNumber);
    return {
      ep,
      key,
      watched: key in watched,
      aired: isEpisodeAired(ep, lastAired, today),
      next: key === nextKey,
      date: ep.airDate ? formatIsoDayShort(ep.airDate, today) : null,
    };
  });

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <RailHeader
        title="Episodes"
        count={
          progress.total > 0 && (
            <span className="flex items-center gap-2">
              <span
                className="relative h-1.5 w-28 overflow-hidden rounded-full bg-well ring-1 ring-divider"
                aria-hidden
              >
                <span
                  className="absolute inset-y-0 left-0 bg-divider"
                  style={{
                    width: `${(progress.aired / progress.total) * 100}%`,
                  }}
                />
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-accent"
                  style={{
                    width: `${(Math.min(progress.watched, progress.total) / progress.total) * 100}%`,
                  }}
                />
              </span>
              <span>
                {progress.watched}/{progress.aired}
                {progress.aired < progress.total ? " aired" : ""} · {percent}%
                {progress.aired < progress.total &&
                  ` · ${progress.total - progress.aired} upcoming`}
              </span>
            </span>
          )
        }
        actions={
          <>
            <button
              type="button"
              disabled={disabled || airedKeys.length === 0}
              onClick={() =>
                onSetWatched(
                  allAiredWatched ? seasonKeys : airedKeys,
                  !allAiredWatched,
                )
              }
              className="rounded-md bg-well px-2.5 py-1 text-xs text-ink ring-1 ring-divider hover:ring-accent disabled:opacity-50"
            >
              {allAiredWatched
                ? "Mark season unwatched"
                : "Mark season watched"}
            </button>
            <div className="flex rounded-md bg-well p-0.5 ring-1 ring-divider">
              {(
                [
                  ["rail", IconLayoutRows, "Show as cards"],
                  ["list", IconLayoutList, "Show as list"],
                ] as const
              ).map(([mode, Icon, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-label={label}
                  aria-pressed={view === mode}
                  title={label}
                  onClick={() => changeView(mode)}
                  className={`rounded p-1 ${
                    view === mode ? "bg-panel text-ink" : "text-faint"
                  }`}
                >
                  <Icon className="size-3.5" />
                </button>
              ))}
            </div>
          </>
        }
      />

      {seasons.length > 1 && (
        <div
          role="tablist"
          aria-label="Seasons"
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]"
        >
          {seasons.map((s) => {
            const keys = s.episodes.map((ep) =>
              episodeKey(ep.seasonNumber, ep.episodeNumber),
            );
            const seen = keys.filter((key) => key in watched).length;
            const active = s.seasonNumber === season.seasonNumber;
            return (
              <button
                key={s.seasonNumber}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelected(s.seasonNumber)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs ring-1 ${
                  active
                    ? "bg-ink font-semibold text-bg ring-ink"
                    : "bg-well text-muted ring-divider hover:text-ink"
                }`}
              >
                {seasonLabel(s)}
                <span
                  className={`tabular-nums ${active ? "text-bg/60" : "text-faint"}`}
                >
                  {seen === keys.length && keys.length > 0 ? (
                    <IconCheck className="size-3" />
                  ) : (
                    `${seen}/${keys.length}`
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {episodes.length === 0 ? (
        <p className="text-sm text-muted">No episodes listed yet.</p>
      ) : view === "rail" ? (
        <RailScroller
          scrollerRef={(el) => {
            scroller.current = el;
          }}
        >
          {episodes.map(({ ep, key, watched, aired, next, date }) => (
            <button
              key={key}
              type="button"
              data-next={next}
              aria-pressed={watched}
              disabled={disabled || !aired}
              onClick={() => onToggle(ep)}
              title={
                aired
                  ? `Mark S${ep.seasonNumber}E${ep.episodeNumber} ${watched ? "unwatched" : "watched"}`
                  : undefined
              }
              className="group flex w-52 shrink-0 snap-start flex-col gap-1.5 text-left disabled:cursor-default"
            >
              <div
                className={`relative aspect-video w-full overflow-hidden rounded-md bg-well ${
                  next
                    ? "ring-2 ring-accent"
                    : "ring-1 ring-divider group-enabled:group-hover:ring-accent"
                }`}
              >
                {ep.stillPath ? (
                  <img
                    loading="lazy"
                    src={tmdbImageUrl(ep.stillPath, "w300")}
                    alt=""
                    className={`h-full w-full object-cover ${
                      aired ? "" : "opacity-35 grayscale"
                    }`}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center font-display text-lg text-faint">
                    {ep.episodeNumber}
                  </div>
                )}
                {next && aired && (
                  <span className="absolute top-1.5 left-1.5 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-ink">
                    Up next
                  </span>
                )}
                {ep.runtime != null && ep.runtime > 0 && (
                  <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 text-[10px] text-white/90">
                    {formatRuntime(ep.runtime)}
                  </span>
                )}
                {aired ? (
                  <span
                    className={`absolute right-1.5 bottom-1.5 flex size-6 items-center justify-center rounded-full ${
                      watched
                        ? "bg-accent text-accent-ink"
                        : "bg-black/50 text-white/60 ring-1 ring-white/30 group-hover:text-white"
                    }`}
                  >
                    <IconCheck className="size-3.5" />
                  </span>
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-ink">
                    {date ? `Airs ${date}` : "TBA"}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-faint tabular-nums">
                S{ep.seasonNumber}E{ep.episodeNumber}
                {date && ` · ${date}`}
              </span>
              <span
                className={`-mt-1 line-clamp-2 text-xs ${
                  watched ? "text-muted" : "text-ink"
                }`}
              >
                {ep.name}
              </span>
            </button>
          ))}
        </RailScroller>
      ) : (
        <ul className="flex flex-col rounded-xl border border-divider bg-panel/60 p-2">
          {episodes.map(({ ep, key, watched, aired, next, date }) => (
            <li key={key}>
              <label
                className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${
                  aired ? "cursor-pointer hover:bg-well/60" : "opacity-55"
                } ${next ? "bg-accent/10" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={watched}
                  disabled={disabled || !aired}
                  onChange={() => onToggle(ep)}
                  className="size-4 accent-accent"
                />
                <span className="w-12 shrink-0 text-xs text-faint tabular-nums">
                  S{ep.seasonNumber}E{ep.episodeNumber}
                </span>
                <span
                  className={`min-w-0 truncate ${watched ? "text-muted" : "text-ink"}`}
                >
                  {ep.name}
                </span>
                {next && aired && (
                  <span className="shrink-0 rounded bg-accent px-1.5 text-[10px] font-bold text-accent-ink">
                    Up next
                  </span>
                )}
                <span className="ml-auto shrink-0 text-xs text-faint tabular-nums">
                  {[formatRuntime(ep.runtime), date ?? (aired ? null : "TBA")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
