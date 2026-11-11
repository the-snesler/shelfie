import type { LibraryItem, MediaType } from "@shelfie/shared";
import { parseEpisodeKey } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { memo, useEffect, useMemo, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router";
import type { AppOutletContext } from "../../App";
import { StaticStars } from "../../components/StaticStars";
import { TruncatedText } from "../../components/Tooltip";
import { useContainerVirtualizer } from "../../components/virtualList";
import type { GameCardDoc } from "../../db/gameCards";
import { refreshCardCaches } from "../../db/refreshCards";
import { GameCover } from "../games/GameCover";
import { selectPlatform } from "../games/platforms";
import { emptyTypeCounts } from "../lists/listStats";
import { parseMediaType } from "../lists/listViewState";
import { MediaFilter } from "../lists/MediaFilter";
import { MediaCover } from "../media/MediaCover";
import {
  feedRows,
  type FeedEntry,
  type FeedRow,
  type LogEntry,
} from "./logbookFeed";
import type { CardMeta } from "../media/useLibraryData";
import {
  cardCover,
  cardName,
  detailHref,
  useLibraryData,
} from "../media/useLibraryData";

const MEDIA_LABEL: Record<MediaType, string> = {
  game: "Game",
  movie: "Movie",
  tv: "TV",
  book: "Book",
};

const EMPTY_NOUN: Record<MediaType, string> = {
  game: "games",
  movie: "movies",
  tv: "TV",
  book: "books",
};

type LibraryDoc = RxDocument<LibraryItem>;

/** px width of the cover slot on completion rows; game cases vary in width
 *  by platform, so covers are centred in a fixed slot to keep names aligned. */
const COVER_SLOT_WIDTH = 50;
/** px width of a movie/TV/book cover on completion rows. */
const MEDIA_COVER_WIDTH = 44;
/** px per mm of case height for game covers — sized so the widest case
 *  (DS/3DS) fits the slot and tall cases stay close to a poster's height. */
const GAME_COVER_SCALE = 0.32;

function LogbookCover({
  item,
  card,
  name,
}: {
  item: LibraryItem;
  card: CardMeta | undefined;
  name: string;
}) {
  const coverUrl = cardCover(item.mediaType, card);
  if (item.mediaType === "game") {
    const game = card as GameCardDoc | undefined;
    return (
      <GameCover
        coverUrl={coverUrl}
        platform={selectPlatform(
          item.platforms,
          game?.platforms ?? [],
          game?.platformReleaseDates ?? [],
        )}
        name={name}
        scale={GAME_COVER_SCALE}
      />
    );
  }
  return (
    <MediaCover
      coverUrl={coverUrl}
      name={name}
      width={MEDIA_COVER_WIDTH}
      mediaType={item.mediaType}
    />
  );
}

// `toLocaleDateString` builds a fresh Intl formatter on every call, which
// dominated row rendering for large logbooks; format with shared ones.
const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "long",
});
const ENTRY_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function monthLabel(month: string): string {
  return MONTH_FORMAT.format(new Date(`${month}-01T00:00:00`));
}

function entryDateLabel(date: string): string {
  return ENTRY_DATE_FORMAT.format(new Date(`${date}T00:00:00`));
}

/** Feed entries are rebuilt whenever any library item changes, so compare
 *  their contents rather than identity. RxDB hands back the same document
 *  instance for an unchanged revision, so `item` identity is meaningful. */
function sameRow(
  prev: { entry: FeedEntry<LibraryDoc>; card: CardMeta | undefined },
  next: { entry: FeedEntry<LibraryDoc>; card: CardMeta | undefined },
): boolean {
  const a = prev.entry;
  const b = next.entry;
  return (
    prev.card === next.card &&
    a.item === b.item &&
    a.date === b.date &&
    a.kind === b.kind &&
    (a.kind !== "episodes" || (b.kind === "episodes" && a.label === b.label))
  );
}

const LogbookRow = memo(function LogbookRow({
  entry,
  card,
}: {
  entry: FeedEntry<LibraryDoc>;
  card: CardMeta | undefined;
}) {
  const { item, date } = entry;
  const name = cardName(item, card);
  const href = detailHref(item, card);
  const rowClass =
    "flex items-center gap-3 rounded px-2 py-1.5 hover:bg-well/60";
  const row =
    entry.kind === "completion" ? (
      <>
        <div
          className="flex shrink-0 justify-center"
          style={{ width: COVER_SLOT_WIDTH }}
        >
          <LogbookCover item={item} card={card} name={name} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-faint">{entryDateLabel(date)}</p>
          <TruncatedText as="p" className="text-sm font-medium text-ink">
            {name}
          </TruncatedText>
          <p className="text-xs text-muted">{MEDIA_LABEL[item.mediaType]}</p>
        </div>
        {item.rating != null && (
          <div className="shrink-0">
            <StaticStars value={item.rating} />
          </div>
        )}
      </>
    ) : (
      <p className="min-w-0 flex flex-1 gap-3 items-baseline">
        <span className="text-xs text-faint">{entryDateLabel(date)}</span>
        <TruncatedText className="text-sm text-ink">{name}</TruncatedText>
        <span className="shrink-0 text-xs text-faint tabular-nums">
          {entry.label}
        </span>
      </p>
    );
  return href ? (
    <Link to={href} className={rowClass}>
      {row}
    </Link>
  ) : (
    <div className={`${rowClass} cursor-default opacity-60`}>{row}</div>
  );
}, sameRow);

function estimateRowSize(row: FeedRow<LibraryDoc>): number {
  if (row.kind === "month") return row.first ? 32 : 56;
  return row.entry.kind === "completion" ? 78 : 32;
}

function LogbookList({
  entries,
  cards,
  type,
}: {
  entries: LogEntry<LibraryDoc>[];
  cards: Map<string, CardMeta>;
  type: MediaType | null;
}) {
  const rows = useMemo(() => feedRows(entries), [entries]);
  const { virtualizer, listRef, scrollMargin } = useContainerVirtualizer({
    count: rows.length,
    estimateSize: (index) => estimateRowSize(rows[index]),
    getItemKey: (index) => rows[index].key,
  });

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center text-muted">
        <p className="font-display text-xl text-ink">
          {type ? `No ${EMPTY_NOUN[type]} logged yet` : "Nothing logged yet"}
        </p>
        <p className="text-sm">
          Mark something finished to start your logbook.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index];
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }}
          >
            {row.kind === "month" ? (
              <h2
                className={`px-2 pb-1 font-display text-lg font-medium text-ink ${
                  row.first ? "" : "pt-6"
                }`}
              >
                {monthLabel(row.month)}
              </h2>
            ) : (
              <LogbookRow
                entry={row.entry}
                card={cards.get(row.entry.item.id)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatsPanel({
  entries,
  items,
  type,
}: {
  entries: LogEntry<LibraryDoc>[];
  items: RxDocument<LibraryItem>[];
  type: MediaType | null;
}) {
  const stats = useMemo(() => {
    const thisYear = String(new Date().getFullYear());
    const byType: Record<MediaType, number> = {
      game: 0,
      movie: 0,
      tv: 0,
      book: 0,
    };
    let thisYearCount = 0;
    for (const entry of entries) {
      byType[entry.item.mediaType] += 1;
      if (entry.date.slice(0, 4) === thisYear) thisYearCount += 1;
    }
    const rated = items.filter((item) => item.rating != null);
    const avgRating =
      rated.length > 0
        ? rated.reduce((sum, item) => sum + (item.rating ?? 0), 0) /
          rated.length
        : null;

    const now = new Date();
    const months: { key: string; label: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push({
        key,
        label: d.toLocaleDateString(undefined, { month: "short" }),
        count: 0,
      });
    }
    const monthIndex = new Map(months.map((m, i) => [m.key, i]));
    for (const entry of entries) {
      const idx = monthIndex.get(entry.date.slice(0, 7));
      if (idx != null) months[idx].count += 1;
    }

    return {
      total: entries.length,
      thisYearCount,
      ratedCount: rated.length,
      avgRating,
      byType,
      months,
    };
  }, [entries, items]);

  const maxMonthCount = Math.max(1, ...stats.months.map((m) => m.count));

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Total logged" value={String(stats.total)} />
        <StatTile label="This year" value={String(stats.thisYearCount)} />
        <StatTile label="Titles rated" value={String(stats.ratedCount)} />
        <StatTile
          label="Avg rating"
          value={stats.avgRating != null ? stats.avgRating.toFixed(1) : "—"}
        />
      </div>

      {type == null && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted">By type</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(Object.keys(MEDIA_LABEL) as MediaType[]).map((type) => (
              <StatTile
                key={type}
                label={MEDIA_LABEL[type]}
                value={String(stats.byType[type])}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-muted">Logged over time</h3>
        <div className="flex h-40 items-end gap-1">
          {stats.months.map((m) => (
            <div
              key={m.key}
              className="flex flex-1 flex-col items-center gap-1"
            >
              <div
                title={`${m.label}: ${m.count}`}
                className={`w-full rounded-t ${m.count === 0 ? "bg-divider" : "bg-accent"}`}
                style={{
                  height: `${m.count === 0 ? 2 : Math.round((m.count / maxMonthCount) * 100)}%`,
                }}
              />
              <span className="text-[10px] text-faint">{m.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-divider bg-panel px-3 py-2">
      <p className="text-xl font-semibold text-ink">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

export default function Logbook() {
  const { db } = useOutletContext<AppOutletContext>();
  const { items, cards } = useLibraryData(db);
  const [tab, setTab] = useState<"logbook" | "stats">("logbook");
  const [searchParams] = useSearchParams();
  const type = parseMediaType(searchParams.get("type"));

  // The library grid only warms cards for unfinished items, so finished
  // titles (e.g. a CSV import of past completions) would otherwise render
  // as bare source ids here. Warm every item that produces a log entry.
  const logged = useMemo(
    () =>
      items.filter(
        (item) =>
          item.completedDates.length > 0 ||
          (item.mediaType === "tv" &&
            Object.values(item.watchedEpisodes).some((date) => date !== "")),
      ),
    [items],
  );
  const loggedKey = logged
    .map((item) => item.id)
    .sort()
    .join(",");
  useEffect(() => {
    void refreshCardCaches(db, logged);
    // loggedKey is the stable dependency; logged only matters via its ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, loggedKey]);

  const { completionEntries, feedEntries } = useMemo(() => {
    const completion: Extract<LogEntry<LibraryDoc>, { kind: "completion" }>[] =
      [];
    for (const item of items) {
      for (const date of item.completedDates) {
        completion.push({ kind: "completion", date, item });
      }
    }
    completion.sort((a, b) => b.date.localeCompare(a.date));

    const feed: LogEntry<LibraryDoc>[] = [...completion];
    for (const item of items) {
      if (item.mediaType !== "tv") continue;
      for (const [key, date] of Object.entries(item.watchedEpisodes)) {
        if (date === "") continue;
        const { season, episode } = parseEpisodeKey(key);
        feed.push({ kind: "episode", date, item, season, episode });
      }
    }
    feed.sort((a, b) => b.date.localeCompare(a.date));

    return { completionEntries: completion, feedEntries: feed };
  }, [items]);

  // Chip counts follow the active tab: every feed entry on the logbook,
  // completions only on stats (episodes don't count toward stats).
  const tabEntries = tab === "logbook" ? feedEntries : completionEntries;
  const typeCounts = useMemo(() => {
    const counts = emptyTypeCounts();
    for (const entry of tabEntries) counts[entry.item.mediaType] += 1;
    return counts;
  }, [tabEntries]);

  const visibleFeed = useMemo(
    () =>
      type ? feedEntries.filter((e) => e.item.mediaType === type) : feedEntries,
    [feedEntries, type],
  );
  const visibleCompletions = useMemo(
    () =>
      type
        ? completionEntries.filter((e) => e.item.mediaType === type)
        : completionEntries,
    [completionEntries, type],
  );
  const visibleItems = useMemo(
    () => (type ? items.filter((item) => item.mediaType === type) : items),
    [items, type],
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-8 md:px-8">
      <header className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            Logbook
          </h1>
          <div className="flex gap-1 rounded bg-well p-1">
            <button
              type="button"
              onClick={() => setTab("logbook")}
              className={
                tab === "logbook"
                  ? "rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
                  : "rounded px-3 py-1.5 text-sm text-muted hover:text-ink"
              }
            >
              Logbook
            </button>
            <button
              type="button"
              onClick={() => setTab("stats")}
              className={
                tab === "stats"
                  ? "rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
                  : "rounded px-3 py-1.5 text-sm text-muted hover:text-ink"
              }
            >
              Stats
            </button>
          </div>
        </div>
        <MediaFilter type={type} counts={typeCounts} />
      </header>
      {tab === "logbook" ? (
        <LogbookList entries={visibleFeed} cards={cards} type={type} />
      ) : (
        <StatsPanel
          entries={visibleCompletions}
          items={visibleItems}
          type={type}
        />
      )}
    </div>
  );
}
