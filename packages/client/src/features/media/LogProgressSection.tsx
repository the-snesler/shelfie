import { STATUS_META_GROUP, type LibraryItem, type LogFormat } from "@shelfie/shared";
import type { RxDocument } from "rxdb";

const HOURS_STEP = 0.5;

export function LogProgressSection({
  item,
  formats,
  formatLabels,
  onChangeFormat,
}: {
  item: RxDocument<LibraryItem> | null;
  formats: readonly LogFormat[];
  formatLabels: Record<LogFormat, string>;
  onChangeFormat: (format: LogFormat) => void;
}) {
  if (!item || formats.length === 0 || STATUS_META_GROUP[item.status] === "planned") {
    return null;
  }

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
          Hours played ({item.progressValue ?? 0}h)
          <input
            type="number"
            min={0}
            step={HOURS_STEP}
            value={item.progressValue ?? 0}
            onChange={(event) => {
              const value = Number(event.target.value);
              void item.incrementalPatch({
                progressValue: Number.isFinite(value) && value >= 0 ? value : 0,
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
            onChange={(event) => {
              const value = Math.trunc(Number(event.target.value));
              void item.incrementalPatch({
                progressValue: Number.isFinite(value) && value >= 0 ? value : 0,
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
            onChange={(event) => {
              void item.incrementalPatch({
                progressValue: Number(event.target.value),
                updatedAt: Date.now(),
              });
            }}
          />
        </label>
      )}
    </div>
  );
}
