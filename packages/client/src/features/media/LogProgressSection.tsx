import {
  STATUS_META_GROUP,
  type LibraryItem,
  type LogFormat,
} from "@shelfie/shared";
import type { RxDocument } from "rxdb";

const HOURS_STEP = 0.5;

/** Parses a draft progress input for `format`; null when the text isn't a
 *  usable value (empty or invalid), meaning "leave progress as it is". */
export function parseProgressDraft(
  draft: string,
  format: LogFormat,
): number | null {
  if (draft.trim() === "") return null;
  const value = Number(draft);
  if (!Number.isFinite(value) || value < 0) return null;
  if (format === "pages") return Math.trunc(value);
  if (format === "percent") return Math.min(100, Math.round(value));
  return value;
}

/** Progress editor. Edits go to `draft` (owned by `LogModal`) and are only
 *  written to the item when the popup closes, so typing "12" or dragging
 *  the slider records one activity entry instead of one per keystroke. */
export function LogProgressSection({
  item,
  formats,
  formatLabels,
  draft,
  onChangeDraft,
  onChangeFormat,
}: {
  item: RxDocument<LibraryItem> | null;
  formats: readonly LogFormat[];
  formatLabels: Record<LogFormat, string>;
  /** Uncommitted input text; null when untouched since the popup opened. */
  draft: string | null;
  onChangeDraft: (draft: string) => void;
  onChangeFormat: (format: LogFormat) => void;
}) {
  if (
    !item ||
    formats.length === 0 ||
    STATUS_META_GROUP[item.status] === "planned"
  ) {
    return null;
  }

  const value = draft ?? String(item.progressValue ?? 0);
  const shown = parseProgressDraft(value, item.progressFormat) ?? 0;

  return (
    <div className="flex flex-col gap-2">
      {formats.length > 1 && (
        <div className="flex gap-2">
          {formats.map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => onChangeFormat(format)}
              className={
                item.progressFormat === format
                  ? "rounded bg-accent px-2 py-1 text-xs font-medium text-accent-ink"
                  : "rounded bg-bg px-2 py-1 text-xs text-ink ring-1 ring-divider"
              }
            >
              {formatLabels[format]}
            </button>
          ))}
        </div>
      )}
      {item.progressFormat === "hours" ? (
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Hours played ({shown}h)
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={HOURS_STEP}
            value={value}
            onChange={(event) => onChangeDraft(event.target.value)}
            className="rounded bg-bg px-3 py-2 text-ink ring-1 ring-divider"
          />
        </label>
      ) : item.progressFormat === "pages" ? (
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Pages read ({shown}p)
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={value}
            onChange={(event) => onChangeDraft(event.target.value)}
            className="rounded bg-bg px-3 py-2 text-ink ring-1 ring-divider"
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm font-medium text-muted">
          Progress ({shown}%)
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={value}
            onChange={(event) => onChangeDraft(event.target.value)}
          />
        </label>
      )}
    </div>
  );
}
