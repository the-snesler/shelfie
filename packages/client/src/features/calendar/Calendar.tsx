import type {
  LibraryItem,
  MediaType,
  TvScheduledEpisode,
} from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { type ComponentType, useEffect, useMemo, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router";
import IconChevronLeft from "~icons/tabler/chevron-left";
import IconChevronRight from "~icons/tabler/chevron-right";
import IconCircleCheck from "~icons/tabler/circle-check";
import IconDeviceGamepad2 from "~icons/tabler/device-gamepad-2";
import IconBook2 from "~icons/tabler/book-2";
import IconDeviceTv from "~icons/tabler/device-tv";
import IconMovie from "~icons/tabler/movie";
import IconX from "~icons/tabler/x";
import type { AppOutletContext } from "../../App";
import { authFetch } from "../../auth";
import { Tooltip, TruncatedText } from "../../components/Tooltip";
import { refreshCardCaches } from "../../db/refreshCards";
import { todayLocalIsoDate } from "../media/libraryActions";
import { MediaCover } from "../media/MediaCover";
import {
  cardCover,
  cardName,
  detailHref,
  useLibraryData,
} from "../media/useLibraryData";
import {
  addDays,
  monthGrid,
  monthTitle,
  parseMonth,
  relativeDayLabel,
  shiftMonth,
} from "./calendarDates";
import {
  buildCalendarEvents,
  type CalendarEvent,
  episodeLabel,
} from "./calendarEvents";

type Event = CalendarEvent<RxDocument<LibraryItem>>;

/** How far ahead the "Upcoming" agenda looks, and how much it lists. */
const UPCOMING_DAYS = 90;
const UPCOMING_LIMIT = 40;
/** Event chips shown per day cell before collapsing into "+N more". */
const CELL_CHIPS = 3;

type IconComponent = ComponentType<{ className?: string }>;

const MEDIA_ICON: Record<MediaType, IconComponent> = {
  game: IconDeviceGamepad2,
  movie: IconMovie,
  tv: IconDeviceTv,
  book: IconBook2,
};

function eventIcon(event: Event): IconComponent {
  return event.kind === "completion"
    ? IconCircleCheck
    : MEDIA_ICON[event.item.mediaType];
}

const KIND_TONE: Record<Event["kind"], string> = {
  release: "text-accent",
  episodes: "text-accent",
  completion: "text-green-400",
};

function eventDetail(event: Event): string {
  switch (event.kind) {
    case "release":
      return event.item.mediaType === "book" ? "Published" : "Release";
    case "episodes": {
      const label = episodeLabel(event.season, event.episodes);
      return event.name ? `${label} · ${event.name}` : label;
    }
    case "completion":
      return "Finished";
  }
}

function eventKey(event: Event): string {
  return event.kind === "episodes"
    ? `${event.kind}:${event.item.id}:${event.date}:${event.season}`
    : `${event.kind}:${event.item.id}:${event.date}`;
}

function groupByDate(events: Event[]): Map<string, Event[]> {
  const byDate = new Map<string, Event[]>();
  for (const event of events) {
    const list = byDate.get(event.date);
    if (list) list.push(event);
    else byDate.set(event.date, [event]);
  }
  return byDate;
}

export default function Calendar() {
  const { db } = useOutletContext<AppOutletContext>();
  const { items, cards } = useLibraryData(db);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<TvScheduledEpisode[]>([]);
  const [scheduleFailed, setScheduleFailed] = useState(false);

  const today = todayLocalIsoDate();
  const month = parseMonth(searchParams.get("month")) ?? today.slice(0, 7);
  const days = useMemo(() => monthGrid(month), [month]);

  // Everything a release could come from; dropped items keep only history.
  const tracked = useMemo(
    () => items.filter((item) => item.status !== "dropped"),
    [items],
  );
  const trackedKey = tracked
    .map((item) => item.id)
    .sort()
    .join(",");
  const tvIds = tracked
    .filter((item) => item.mediaType === "tv")
    .map((item) => item.sourceId)
    .sort()
    .join(",");

  // Warm the local card caches: release dates move (game delays, newly
  // announced seasons) and `nextEpisodeToAir` rolls forward weekly.
  useEffect(() => {
    void refreshCardCaches(db, tracked);
    // trackedKey is the stable dependency; tracked only matters via its ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, trackedKey]);

  // One request covers both the visible grid and the upcoming agenda.
  const from = days[0] < today ? days[0] : today;
  const agendaEnd = addDays(today, UPCOMING_DAYS);
  const lastDay = days[days.length - 1];
  const to = lastDay > agendaEnd ? lastDay : agendaEnd;

  useEffect(() => {
    if (!tvIds) {
      setSchedule([]);
      return;
    }
    let active = true;
    void authFetch(`/api/tv/schedule?ids=${tvIds}&from=${from}&to=${to}`)
      .then((res) => {
        if (!res.ok) throw new Error(`schedule ${res.status}`);
        return res.json() as Promise<TvScheduledEpisode[]>;
      })
      .then((rows) => {
        if (!active) return;
        setSchedule(rows);
        setScheduleFailed(false);
      })
      .catch(() => {
        if (active) setScheduleFailed(true);
      });
    return () => {
      active = false;
    };
  }, [tvIds, from, to]);

  const events = useMemo(
    () => buildCalendarEvents(items, cards, schedule),
    [items, cards, schedule],
  );
  const byDate = useMemo(() => groupByDate(events), [events]);

  const monthEvents = events.filter((e) => e.date.startsWith(month));
  const releaseCount = monthEvents.filter(
    (e) => e.kind !== "completion",
  ).length;
  const finishedCount = monthEvents.length - releaseCount;

  const upcoming = useMemo(
    () =>
      events
        .filter(
          (e) =>
            e.kind !== "completion" && e.date >= today && e.date <= agendaEnd,
        )
        .slice(0, UPCOMING_LIMIT),
    [events, today, agendaEnd],
  );

  function goToMonth(next: string) {
    setSelected(null);
    setSearchParams(next === today.slice(0, 7) ? {} : { month: next });
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-8 md:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            Calendar
          </h1>
          <p className="mt-1 text-sm text-muted">
            {releaseCount} {releaseCount === 1 ? "release" : "releases"} ·{" "}
            {finishedCount} finished
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goToMonth(today.slice(0, 7))}
            disabled={month === today.slice(0, 7)}
            className="mr-2 rounded border border-divider px-3 py-1.5 text-sm text-muted hover:text-ink disabled:opacity-40 disabled:hover:text-muted"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => goToMonth(shiftMonth(month, -1))}
            className="rounded p-1.5 text-muted hover:bg-well hover:text-ink"
          >
            <IconChevronLeft className="size-5" />
          </button>
          <h2 className="w-40 text-center font-display text-lg font-medium text-ink">
            {monthTitle(month)}
          </h2>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => goToMonth(shiftMonth(month, 1))}
            className="rounded p-1.5 text-muted hover:bg-well hover:text-ink"
          >
            <IconChevronRight className="size-5" />
          </button>
        </div>
      </header>

      {scheduleFailed ? (
        <p className="rounded border border-divider bg-panel px-3 py-2 text-sm text-muted">
          Couldn't reach the server — showing only the episode dates cached on
          this device.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <MonthGrid
          days={days}
          month={month}
          today={today}
          selected={selected}
          byDate={byDate}
          onSelect={(day) => setSelected(day === selected ? null : day)}
        />
        <aside className="flex flex-col gap-3">
          {selected ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-medium text-ink">
                  {relativeDayLabel(selected, today)}
                </h2>
                <button
                  type="button"
                  aria-label="Back to upcoming"
                  onClick={() => setSelected(null)}
                  className="rounded p-1 text-muted hover:bg-well hover:text-ink"
                >
                  <IconX className="size-4" />
                </button>
              </div>
              <EventList
                events={byDate.get(selected) ?? []}
                empty="Nothing on this day."
              />
            </>
          ) : (
            <>
              <h2 className="font-display text-lg font-medium text-ink">
                Upcoming
              </h2>
              <Agenda events={upcoming} today={today} />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function MonthGrid({
  days,
  month,
  today,
  selected,
  byDate,
  onSelect,
}: {
  days: string[];
  month: string;
  today: string;
  selected: string | null;
  byDate: Map<string, Event[]>;
  onSelect: (day: string) => void;
}) {
  return (
    <div className="self-start overflow-hidden rounded border border-divider">
      <div className="grid grid-cols-7 border-b border-divider bg-well">
        {days.slice(0, 7).map((day) => (
          <div
            key={day}
            className="px-2 py-1.5 text-center text-xs font-medium text-faint"
          >
            {new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
              weekday: "short",
            })}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-divider">
        {days.map((day) => {
          const dayEvents = byDate.get(day) ?? [];
          const inMonth = day.startsWith(month);
          const isToday = day === today;
          const isSelected = day === selected;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelect(day)}
              aria-pressed={isSelected}
              aria-label={`${relativeDayLabel(day, today)}: ${dayEvents.length} ${dayEvents.length === 1 ? "event" : "events"}`}
              className={`flex min-h-16 flex-col gap-1 p-1.5 text-left md:min-h-28 ${
                inMonth ? "bg-panel" : "bg-bg"
              } ${isSelected ? "ring-2 ring-accent ring-inset" : "hover:bg-well"}`}
            >
              <span
                className={`flex size-6 items-center justify-center rounded-full text-xs tabular-nums ${
                  isToday
                    ? "bg-accent font-semibold text-accent-ink"
                    : inMonth
                      ? "text-ink"
                      : "text-faint"
                }`}
              >
                {Number(day.slice(8))}
              </span>
              {/* Narrow screens: one dot per kind present. */}
              <span className="flex gap-1 md:hidden">
                {(["release", "episodes", "completion"] as const)
                  .filter((kind) => dayEvents.some((e) => e.kind === kind))
                  .map((kind) => (
                    <span
                      key={kind}
                      className={`size-1.5 rounded-full ${
                        kind === "completion" ? "bg-green-400" : "bg-accent"
                      }`}
                    />
                  ))}
              </span>
              <span className="hidden min-w-0 flex-col gap-0.5 md:flex">
                {dayEvents.slice(0, CELL_CHIPS).map((event) => {
                  const Icon = eventIcon(event);
                  return (
                    <Tooltip
                      key={eventKey(event)}
                      content={`${cardName(event.item, event.card)} — ${eventDetail(event)}`}
                    >
                      <span
                        className={`flex min-w-0 items-center gap-1 rounded bg-well px-1 py-0.5 text-[11px] leading-4 ${
                          inMonth ? "text-ink" : "text-muted"
                        }`}
                      >
                        <Icon
                          className={`size-3 shrink-0 ${KIND_TONE[event.kind]}`}
                        />
                        <span className="truncate">
                          {cardName(event.item, event.card)}
                        </span>
                      </span>
                    </Tooltip>
                  );
                })}
                {dayEvents.length > CELL_CHIPS ? (
                  <span className="px-1 text-[11px] text-faint">
                    +{dayEvents.length - CELL_CHIPS} more
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Agenda({ events, today }: { events: Event[]; today: string }) {
  const grouped = useMemo(() => [...groupByDate(events)], [events]);
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing scheduled in the next {UPCOMING_DAYS} days. Wishlisted games and
        shows you're following show up here as dates are announced.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {grouped.map(([date, dayEvents]) => (
        <section key={date} className="flex flex-col gap-1">
          <h3 className="text-xs font-medium tracking-wide text-faint uppercase">
            {relativeDayLabel(date, today)}
          </h3>
          <EventList events={dayEvents} empty="" />
        </section>
      ))}
    </div>
  );
}

function EventList({ events, empty }: { events: Event[]; empty: string }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted">{empty}</p>;
  }
  return (
    <div className="flex flex-col">
      {events.map((event) => (
        <EventRow key={eventKey(event)} event={event} />
      ))}
    </div>
  );
}

function EventRow({ event }: { event: Event }) {
  const { item, card } = event;
  const name = cardName(item, card);
  const href = detailHref(item, card);
  const Icon = eventIcon(event);
  const rowClass =
    "flex items-center gap-3 rounded px-2 py-1.5 hover:bg-well/60";
  const row = (
    <>
      <MediaCover
        coverUrl={cardCover(item.mediaType, card)}
        name={name}
        width={36}
        mediaType={item.mediaType}
      />
      <div className="min-w-0 flex-1">
        <TruncatedText as="p" className="text-sm font-medium text-ink">
          {name}
        </TruncatedText>
        <p className="flex min-w-0 items-center gap-1 text-xs text-muted">
          <Icon className={`size-3.5 shrink-0 ${KIND_TONE[event.kind]}`} />
          <TruncatedText>{eventDetail(event)}</TruncatedText>
        </p>
      </div>
    </>
  );
  return href ? (
    <Link to={href} className={rowClass}>
      {row}
    </Link>
  ) : (
    <div className={`${rowClass} cursor-default opacity-60`}>{row}</div>
  );
}
