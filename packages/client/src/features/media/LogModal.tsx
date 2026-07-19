import { LOG_FORMATS_BY_MEDIA, STATUS_META_GROUP } from "@shelfie/shared";
import type { ItemStatus, LibraryItem, LogFormat } from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useState } from "react";
import IconX from "~icons/tabler/x";
import type { ShelfieDatabase } from "../../db/database";
import { StarRating } from "../detail/StarRating";
import type { LogTarget } from "./libraryActions";
import { newLibraryItem } from "./libraryActions";
import {
  COMPLETION_STATUSES,
  STATUS_ICONS,
  STATUS_LABELS,
  STATUSES_BY_MEDIA,
} from "./status";

const FORMAT_LABELS: Record<LogFormat, string> = {
  hours: "Hours",
  percent: "Percent",
  pages: "Pages",
};

/** Local-time YYYY-MM-DD (avoids the UTC off-by-one of toISOString). */
function toLocalIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Shared detailed-editing popup: status, platform (games only), progress,
 *  rating, completion dates and notes for one library item. Reached from
 *  the library grid's `+` button and a Detail page's split status button. */
export function LogModal({
  db,
  target,
  item,
  onClose,
}: {
  db: ShelfieDatabase;
  target: LogTarget;
  item: RxDocument<LibraryItem> | null;
  onClose: () => void;
}) {
  const [datePrompt, setDatePrompt] = useState<{ date: string } | null>(null);

  function handleStatusChange(status: ItemStatus) {
    if (item) {
      void item.incrementalPatch({ status, updatedAt: Date.now() });
    } else {
      void db.library_items.insert(newLibraryItem(target, status));
    }
    if (COMPLETION_STATUSES[status]) {
      setDatePrompt({ date: toLocalIsoDate(new Date()) });
    }
  }

  function togglePlatform(p: string) {
    if (!item) return;
    const has = item.platforms.includes(p);
    const platforms = has
      ? item.platforms.filter((x) => x !== p)
      : [...item.platforms, p];
    void item.incrementalPatch({ platforms, updatedAt: Date.now() });
  }

  function handleRemove() {
    if (!item) return;
    void item
      .incrementalPatch({ updatedAt: Date.now() })
      .then((doc) => doc.incrementalRemove());
    onClose();
  }

  async function addCompletionDate(date: string) {
    if (!date) return;
    const doc = await db.library_items
      .findOne(`${target.mediaType}:${target.sourceId}`)
      .exec();
    setDatePrompt(null);
    if (!doc || doc.completedDates.includes(date)) return;
    await doc.incrementalPatch({
      completedDates: [...doc.completedDates, date],
      updatedAt: Date.now(),
    });
  }

  function removeCompletionDate(date: string) {
    if (!item) return;
    void item.incrementalPatch({
      completedDates: item.completedDates.filter((d) => d !== date),
      updatedAt: Date.now(),
    });
  }

  function handleRating(value: number | null) {
    if (!item) return;
    void item.incrementalPatch({ rating: value, updatedAt: Date.now() });
  }

  function handleFormatChange(format: LogFormat) {
    if (!item || item.progressFormat === format) return;
    // No cross-unit conversion (42% ≠ 42h ≠ 42p) — reset value on switch.
    void item.incrementalPatch({
      progressFormat: format,
      progressValue: null,
      updatedAt: Date.now(),
    });
  }

  const statuses = STATUSES_BY_MEDIA[target.mediaType];
  const labels = STATUS_LABELS[target.mediaType];
  const formats = LOG_FORMATS_BY_MEDIA[target.mediaType];

  return (
    <div data-log-scroll className="flex flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">{target.name}</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="text-muted hover:text-ink"
        >
          <IconX />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {statuses.map((status) => {
          const Icon = STATUS_ICONS[status];
          const active = item?.status === status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => handleStatusChange(status)}
              className={
                active
                  ? "flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink"
                  : "flex items-center gap-2 rounded bg-bg px-3 py-2 text-sm text-ink ring-1 ring-divider"
              }
            >
              <Icon />
              {labels[status]}
            </button>
          );
        })}
      </div>
      {item && target.mediaType === "game" && target.platforms.length > 0 && (
        <fieldset className="flex flex-col gap-1 text-sm font-medium text-muted">
          <legend>Platform</legend>
          <div className="flex flex-wrap gap-2">
            {target.platforms.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => togglePlatform(p)}
                className={
                  item.platforms.includes(p)
                    ? "rounded bg-accent px-2 py-1 text-xs font-medium text-accent-ink"
                    : "rounded bg-bg px-2 py-1 text-xs text-ink ring-1 ring-divider"
                }
              >
                {p}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {item &&
        formats.length > 0 &&
        STATUS_META_GROUP[item.status] !== "planned" && (
          <div className="flex flex-col gap-2">
            {formats.length > 1 && (
              <div className="flex gap-2">
                {formats.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => handleFormatChange(f)}
                    className={
                      item.progressFormat === f
                        ? "rounded bg-accent px-2 py-1 text-xs font-medium text-accent-ink"
                        : "rounded bg-bg px-2 py-1 text-xs text-ink ring-1 ring-divider"
                    }
                  >
                    {FORMAT_LABELS[f]}
                  </button>
                ))}
              </div>
            )}
            {item.progressFormat === "hours" ? (
              <label className="flex flex-col gap-1 text-sm font-medium text-muted">
                Hours played ({item.progressValue ?? 0}h)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={item.progressValue ?? 0}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    void item.incrementalPatch({
                      progressValue: Number.isFinite(n) && n >= 0 ? n : 0,
                      updatedAt: Date.now(),
                    });
                  }}
                  className="rounded bg-bg px-3 py-2 text-ink ring-1 ring-divider"
                />
              </label>
            ) : item.progressFormat === "pages" ? (
              <label className="flex flex-col gap-1 text-sm font-medium text-muted">
                Pages read ({item.progressValue ?? 0}p)
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={item.progressValue ?? 0}
                  onChange={(e) => {
                    const n = Math.trunc(Number(e.target.value));
                    void item.incrementalPatch({
                      progressValue: Number.isFinite(n) && n >= 0 ? n : 0,
                      updatedAt: Date.now(),
                    });
                  }}
                  className="rounded bg-bg px-3 py-2 text-ink ring-1 ring-divider"
                />
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-sm font-medium text-muted">
                Progress ({item.progressValue ?? 0}%)
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={item.progressValue ?? 0}
                  onChange={(e) => {
                    void item.incrementalPatch({
                      progressValue: Number(e.target.value),
                      updatedAt: Date.now(),
                    });
                  }}
                />
              </label>
            )}
          </div>
        )}
      {item && (
        <div className="flex flex-col gap-1 text-sm font-medium text-muted">
          Rating
          <StarRating value={item.rating} onChange={handleRating} />
        </div>
      )}
      {item && item.completedDates.length > 0 && (
        <div className="flex flex-col gap-1 text-sm font-medium text-muted">
          Completed
          <div className="flex flex-wrap gap-2">
            {[...item.completedDates]
              .sort()
              .reverse()
              .map((date) => (
                <button
                  key={date}
                  type="button"
                  onClick={() => removeCompletionDate(date)}
                  title="Click to remove"
                  className="group flex items-center gap-1 rounded bg-bg px-2 py-1 text-xs text-ink ring-1 ring-divider hover:ring-accent"
                >
                  {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                  <IconX className="opacity-0 group-hover:opacity-100" />
                </button>
              ))}
          </div>
        </div>
      )}
      {item && (
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Notes
          <textarea
            key={item.id}
            defaultValue={item.notes}
            onBlur={(e) => {
              if (e.target.value !== item.notes) {
                void item.incrementalPatch({
                  notes: e.target.value,
                  updatedAt: Date.now(),
                });
              }
            }}
            rows={4}
            className="rounded bg-bg px-3 py-2 text-ink ring-1 ring-divider"
          />
        </label>
      )}
      {datePrompt && (
        <div className="flex flex-col gap-3 rounded border border-divider bg-bg p-4">
          <p className="text-sm font-medium text-ink">
            When did you finish it?
          </p>
          <input
            type="date"
            value={datePrompt.date}
            onChange={(e) => setDatePrompt({ date: e.target.value })}
            className="rounded bg-panel px-3 py-2 text-ink ring-1 ring-divider"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDatePrompt(null)}
              className="rounded px-3 py-1 text-sm text-muted hover:text-ink"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => void addCompletionDate(datePrompt.date)}
              className="rounded bg-accent px-3 py-1 text-sm font-medium text-accent-ink"
            >
              Add date
            </button>
          </div>
        </div>
      )}
      {item && (
        <button
          type="button"
          onClick={handleRemove}
          className="text-sm text-danger hover:underline"
        >
          Remove from library
        </button>
      )}
    </div>
  );
}
