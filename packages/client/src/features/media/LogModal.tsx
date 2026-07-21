import { LOG_FORMATS_BY_MEDIA, STATUS_META_GROUP } from "@shelfie/shared";
import type {
  ItemStatus,
  LibraryItem,
  LogFormat,
  MetaStatus,
} from "@shelfie/shared";
import type { RxDocument } from "rxdb";
import { useState } from "react";
import type { ShelfieDatabase } from "../../db/database";
import type { LogTarget } from "./libraryActions";
import { newLibraryItem } from "./libraryActions";
import {
  COMPLETION_STATUSES,
  STATUS_LABELS,
  STATUSES_BY_MEDIA,
} from "./status";
import { LogCompletedDates } from "./LogCompletedDates";
import { LogCompletionPrompt } from "./LogCompletionPrompt";
import { LogHeader } from "./LogHeader";
import { LogNotesField } from "./LogNotesField";
import { LogPlatformSection } from "./LogPlatformSection";
import { LogProgressSection } from "./LogProgressSection";
import { LogRatingSection } from "./LogRatingSection";
import { LogStatusSection } from "./LogStatusSection";

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
  const [datePrompt, setDatePrompt] = useState<{
    status: ItemStatus;
    date: string;
    picking: boolean;
  } | null>(null);

  function handleStatusChange(status: ItemStatus) {
    // Completion statuses defer the actual write until a date is chosen
    // (see commitCompletion) — writing immediately would move the item to
    // a different library-grid section right away, unmounting this popover
    // mid-prompt.
    if (COMPLETION_STATUSES[status]) {
      setDatePrompt({
        status,
        date: toLocalIsoDate(new Date()),
        picking: false,
      });
      return;
    }
    setDatePrompt(null);
    if (item) {
      void item.incrementalPatch({ status, updatedAt: Date.now() });
    } else {
      void db.library_items.insert(newLibraryItem(target, status));
    }
  }

  function togglePlatform(p: string) {
    if (!item) return;
    void item.incrementalModify((docData) => {
      const has = docData.platforms.includes(p);
      return {
        ...docData,
        platforms: has
          ? docData.platforms.filter((x) => x !== p)
          : [...docData.platforms, p],
        updatedAt: Date.now(),
      };
    });
  }

  function handleRemove() {
    if (!item) return;
    void item
      .incrementalPatch({ updatedAt: Date.now() })
      .then((doc) => doc.incrementalRemove());
    onClose();
  }

  /** Commits the pending status (set by handleStatusChange, held in
   *  datePrompt.status) together with the chosen completion date in one
   *  write — the status change and the answer to "when did you finish
   *  it?" land atomically, only once the prompt is answered. `date` is
   *  null for "Unknown date" (status set, no date recorded). */
  async function commitCompletion(date: string | null) {
    const status = datePrompt?.status;
    if (!status) return;
    setDatePrompt(null);
    if (item) {
      const doc = await db.library_items
        .findOne(`${target.mediaType}:${target.sourceId}`)
        .exec();
      if (!doc) return;
      const completedDates =
        date && !doc.completedDates.includes(date)
          ? [...doc.completedDates, date]
          : doc.completedDates;
      await doc.incrementalPatch({
        status,
        completedDates,
        updatedAt: Date.now(),
      });
    } else {
      const base = newLibraryItem(target, status);
      await db.library_items.insert({
        ...base,
        completedDates: date ? [date] : [],
      });
    }
  }

  function removeCompletionDate(date: string) {
    if (!item) return;
    void item.incrementalModify((docData) => ({
      ...docData,
      completedDates: docData.completedDates.filter((d) => d !== date),
      updatedAt: Date.now(),
    }));
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
  const groupedStatuses = Object.entries(
    statuses.reduce(
      (acc, status) => {
        acc[STATUS_META_GROUP[status]] = [
          ...(acc[STATUS_META_GROUP[status]] ?? []),
          status,
        ];
        return acc;
      },
      {} as Record<MetaStatus, ItemStatus[]>,
    ),
  ) as [MetaStatus, ItemStatus[]][];
  const labels = STATUS_LABELS[target.mediaType];
  const formats = LOG_FORMATS_BY_MEDIA[target.mediaType];

  const releaseDate = target.releaseDate;

  return (
    <div data-log-scroll className="flex flex-col gap-3 overflow-y-auto p-3">
      <LogHeader targetName={target.name} onClose={onClose} />
      <LogStatusSection
        statuses={groupedStatuses}
        labels={labels}
        activeStatus={datePrompt?.status ?? item?.status ?? null}
        onSelectStatus={handleStatusChange}
      />
      <LogCompletionPrompt
        prompt={datePrompt}
        releaseDate={releaseDate ?? null}
        onSelectToday={() => void commitCompletion(toLocalIsoDate(new Date()))}
        onSelectReleaseDate={() => void commitCompletion(releaseDate ?? null)}
        onChooseOtherDate={(status) =>
          setDatePrompt({
            status: status as ItemStatus,
            date: toLocalIsoDate(new Date()),
            picking: true,
          })
        }
        onDateChange={(date) =>
          setDatePrompt((current) =>
            current
              ? {
                  status: current.status,
                  date,
                  picking: true,
                }
              : current,
          )
        }
        onCommitDate={(date) => void commitCompletion(date)}
        onCommitUnknown={() => void commitCompletion(null)}
      />
      <LogPlatformSection
        mediaType={target.mediaType}
        platforms={target.platforms}
        selectedPlatforms={item?.platforms ?? []}
        onTogglePlatform={togglePlatform}
      />
      <LogProgressSection
        item={item}
        formats={formats}
        formatLabels={FORMAT_LABELS}
        onChangeFormat={handleFormatChange}
      />
      <LogRatingSection item={item} onChange={handleRating} />
      <LogCompletedDates item={item} onRemove={removeCompletionDate} />
      <LogNotesField item={item} />
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
