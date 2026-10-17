import type { LibraryItem, MediaType } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router";
import IconSparkles from "~icons/tabler/sparkles";
import type { AppOutletContext } from "../../App";
import { refreshCardCaches } from "../../db/refreshCards";
import { MediaCover } from "../media/MediaCover";
import { todayLocalIsoDate } from "../media/libraryActions";
import { STATUS_LABELS } from "../media/status";
import { cardCover, detailHref, useLibraryData } from "../media/useLibraryData";
import {
  isRecommendationCandidate,
  rankRecommendations,
  type Recommendation,
} from "./ranking";

const MEDIA_LABELS: Record<MediaType, string> = {
  game: "Game",
  movie: "Movie",
  tv: "TV show",
  book: "Book",
};
const FILTERS: readonly { type: MediaType | null; label: string }[] = [
  { type: null, label: "All" },
  { type: "game", label: "Games" },
  { type: "movie", label: "Movies" },
  { type: "tv", label: "TV" },
  { type: "book", label: "Books" },
];

const START_LABELS: Record<MediaType, string> = {
  game: "Start playing",
  movie: "Start watching",
  tv: "Start watching",
  book: "Start reading",
};

function RecommendationCard({
  pick,
}: {
  pick: Recommendation<RxDocument<LibraryItem>>;
}) {
  const { item, card, reasons } = pick;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const href = detailHref(item, card);
  const cover = (
    <MediaCover
      coverUrl={cardCover(item.mediaType, card)}
      name={card.name}
      width={72}
      mediaType={item.mediaType}
    />
  );
  const startLabel =
    item.status === "paused" ? "Resume" : START_LABELS[item.mediaType];

  async function start() {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      await item.incrementalModify((current) =>
        isRecommendationCandidate(current)
          ? { ...current, status: "active", updatedAt: Date.now() }
          : current,
      );
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="flex gap-4 rounded-xl border border-divider bg-panel p-4">
      <div className="shrink-0">
        {href ? <Link to={href}>{cover}</Link> : cover}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <p className="text-xs text-faint">
            {MEDIA_LABELS[item.mediaType]} ·{" "}
            {STATUS_LABELS[item.mediaType][item.status]}
          </p>
          <h2 className="font-display text-lg font-medium leading-snug text-ink">
            {href ? (
              <Link to={href} className="hover:text-accent">
                {card.name}
              </Link>
            ) : (
              card.name
            )}
          </h2>
        </div>
        <ul className="flex flex-1 flex-col gap-1 text-sm text-muted">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void start()}
            disabled={saving}
            aria-label={`${startLabel} ${card.name}`}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
          >
            {saving ? "Saving…" : startLabel}
          </button>
          {href && (
            <Link to={href} className="text-sm text-muted hover:text-ink">
              Details
            </Link>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            Could not update this title. Try again.
          </p>
        )}
      </div>
    </li>
  );
}

export default function Recommendations() {
  const { db } = useOutletContext<AppOutletContext>();
  const { items, cards } = useLibraryData(db);
  const [refreshing, setRefreshing] = useState(false);
  const requestedIds = useRef(new Set<string>());
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedType = searchParams.get("type");
  const type =
    FILTERS.find((filter) => filter.type === requestedType)?.type ?? null;
  const today = todayLocalIsoDate();
  const picks = useMemo(
    () =>
      rankRecommendations(items, cards, {
        today,
        mediaType: type ?? undefined,
      }),
    [items, cards, today, type],
  );
  const ratedCount = items.filter(
    (item) =>
      item.rating != null && item.rating >= 4 && item.status !== "dropped",
  ).length;

  // At most 24 card lookups per refresh: favor eight preference examples,
  // then sixteen queued titles. Ranking still uses every available local
  // card, including offline. No catalog-wide search or detail fan-out.
  const refreshKey = useMemo(() => {
    const liked = [...items]
      .filter(
        (item) =>
          item.rating != null && item.rating >= 4 && item.status !== "dropped",
      )
      .sort(
        (a, b) =>
          (b.rating ?? 0) - (a.rating ?? 0) || b.updatedAt - a.updatedAt,
      )
      .slice(0, 8);
    const queued = [...items]
      .filter(
        (item) =>
          isRecommendationCandidate(item) && (!type || item.mediaType === type),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 16);
    return [...new Set([...liked, ...queued].map((item) => item.id))]
      .sort()
      .join(",");
  }, [items, type]);

  useEffect(() => {
    if (!refreshKey) return;
    const newIds = refreshKey
      .split(",")
      .filter((id) => !requestedIds.current.has(id));
    if (newIds.length === 0) return;
    const targets = newIds.map((id) => {
      requestedIds.current.add(id);
      const [mediaType, sourceId] = id.split(":");
      return { mediaType: mediaType as MediaType, sourceId };
    });
    let active = true;
    setRefreshing(true);
    void refreshCardCaches(db, targets).finally(() => {
      if (active) setRefreshing(false);
    });
    return () => {
      active = false;
      setRefreshing(false);
    };
  }, [db, refreshKey]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-8 md:px-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          Recommendations
        </h1>
        <p className="max-w-2xl text-sm text-muted">
          Choose what to play, watch, or read next from your backlog and
          wishlist.
        </p>
      </header>
      <div className="flex items-start gap-3 rounded-lg border border-divider bg-well/60 px-4 py-3">
        <IconSparkles className="mt-0.5 size-5 shrink-0 text-accent" />
        <p className="text-sm text-muted">
          {ratedCount > 0
            ? "Picks match genres, authors, directors, and developers from titles you rated 4 stars or higher. Each match shows you why."
            : "Start with something already on your shelf, or return to a paused title. Rate a few favorites 4 stars or higher to get more personal picks."}
        </p>
      </div>
      <div className="flex flex-wrap gap-1" aria-label="Media type">
        {FILTERS.map((filter) => (
          <button
            key={filter.type ?? "all"}
            type="button"
            aria-pressed={type === filter.type}
            onClick={() =>
              setSearchParams(filter.type ? { type: filter.type } : {})
            }
            className={
              type === filter.type
                ? "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
                : "rounded-md bg-well px-3 py-1.5 text-sm text-muted hover:text-ink"
            }
          >
            {filter.label}
          </button>
        ))}
      </div>
      {picks.length > 0 ? (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {picks.map((pick) => (
            <RecommendationCard key={pick.item.id} pick={pick} />
          ))}
        </ul>
      ) : refreshing ? (
        <p className="py-10 text-center text-sm text-muted">
          Finding picks from your shelf…
        </p>
      ) : (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <p className="font-display text-xl text-ink">No picks ready yet</p>
          <p className="max-w-md text-sm text-muted">
            Add titles to your backlog or wishlist, or try another media type.
            Upcoming releases stay in your calendar.
          </p>
          <div className="flex gap-4 text-sm">
            <Link to="/search" className="text-accent hover:underline">
              Find something new
            </Link>
            <Link to="/calendar" className="text-muted hover:text-ink">
              Open calendar
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
