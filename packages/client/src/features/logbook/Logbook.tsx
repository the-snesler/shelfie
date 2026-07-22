import type { LibraryItem, MediaType } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router";
import IconStar from "~icons/tabler/star";
import IconStarFilled from "~icons/tabler/star-filled";
import IconStarHalfFilled from "~icons/tabler/star-half-filled";
import type { AppOutletContext } from "../../App";
import { MediaCover } from "../media/MediaCover";
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

interface LogEntry {
  date: string;
  item: RxDocument<LibraryItem>;
  card: CardMeta | undefined;
}

/** Read-only half-step star display for a logbook row's rating — unlike
 *  `StarRating` (detail/StarRating.tsx), which is an interactive control
 *  with a required onChange and a clear button. */
function StaticStars({ value }: { value: number | null }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = value != null && value >= i;
        const half = !filled && value != null && value >= i - 0.5;
        const Icon = filled
          ? IconStarFilled
          : half
            ? IconStarHalfFilled
            : IconStar;
        return (
          <Icon
            key={i}
            className={
              filled || half
                ? "size-3.5 text-amber-400"
                : "size-3.5 text-divider"
            }
          />
        );
      })}
    </div>
  );
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
  });
}

function entryDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function LogbookRow({ entry }: { entry: LogEntry }) {
  const { item, card, date } = entry;
  const name = cardName(item, card);
  const href = detailHref(item, card);
  const row = (
    <>
      <MediaCover
        coverUrl={cardCover(item.mediaType, card)}
        name={name}
        width={44}
        mediaType={item.mediaType}
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-faint">{entryDateLabel(date)}</p>
        <p className="truncate text-sm font-medium text-ink">{name}</p>
        <p className="text-xs text-muted">{MEDIA_LABEL[item.mediaType]}</p>
      </div>
      {item.rating != null && (
        <div className="shrink-0">
          <StaticStars value={item.rating} />
        </div>
      )}
    </>
  );
  const rowClass =
    "flex items-center gap-3 rounded px-2 py-1.5 hover:bg-well/60";
  return href ? (
    <Link to={href} className={rowClass}>
      {row}
    </Link>
  ) : (
    <div className={`${rowClass} cursor-default opacity-60`}>{row}</div>
  );
}

function LogbookList({ entries }: { entries: LogEntry[] }) {
  const months = useMemo(() => {
    const map = new Map<string, LogEntry[]>();
    for (const entry of entries) {
      const month = entry.date.slice(0, 7);
      const arr = map.get(month);
      if (arr) arr.push(entry);
      else map.set(month, [entry]);
    }
    return [...map.entries()];
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center text-muted">
        <p className="font-display text-xl text-ink">Nothing logged yet</p>
        <p className="text-sm">
          Mark something finished to start your logbook.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {months.map(([month, monthEntries]) => (
        <section key={month} className="flex flex-col gap-1">
          <h2 className="px-2 font-display text-lg font-medium text-ink">
            {monthLabel(month)}
          </h2>
          <div className="flex flex-col">
            {monthEntries.map((entry, i) => (
              <LogbookRow
                key={`${entry.item.id}:${entry.date}:${i}`}
                entry={entry}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function StatsPanel({
  entries,
  items,
}: {
  entries: LogEntry[];
  items: RxDocument<LibraryItem>[];
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

  const entries = useMemo(() => {
    const result: LogEntry[] = [];
    for (const item of items) {
      for (const date of item.completedDates) {
        result.push({ date, item, card: cards.get(item.id) });
      }
    }
    result.sort((a, b) => b.date.localeCompare(a.date));
    return result;
  }, [items, cards]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-8 md:px-8">
      <header className="flex items-center justify-between gap-3">
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
      </header>
      {tab === "logbook" ? (
        <LogbookList entries={entries} />
      ) : (
        <StatsPanel entries={entries} items={items} />
      )}
    </div>
  );
}
