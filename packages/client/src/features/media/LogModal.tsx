import {
  instantMoment,
  LOG_FORMATS_BY_MEDIA,
  STATUS_META_GROUP,
} from "@shelfie/shared";
import type {
  ItemStatus,
  LibraryItem,
  LogFormat,
  Moment,
  Storefront,
} from "@shelfie/shared";
import { randomToken, type RxDocument } from "rxdb";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import IconTrash from "~icons/tabler/trash";
import type { ShelfieDatabase } from "../../db/database";
import type { LogTarget } from "./libraryActions";
import { newLibraryItem, todayLocalIsoDate } from "./libraryActions";
import { celebrate, celebrationOrigin } from "./celebrate";
import {
  COMPLETION_STATUSES,
  STATUS_LABELS,
  STATUSES_BY_MEDIA,
} from "./status";
import { LogCompletedDates } from "./LogCompletedDates";
import {
  LogCompletionPrompt,
  type LogCompletionPromptState,
} from "./LogCompletionPrompt";
import { LogExcitementSection } from "./LogExcitementSection";
import { LogHeader } from "./LogHeader";
import { LogNotesField } from "./LogNotesField";
import { LogPlatformSection } from "./LogPlatformSection";
import { LogStorefrontSection } from "./LogStorefrontSection";
import { LogProgressSection, parseProgressDraft } from "./LogProgressSection";
import { LogRatingSection } from "./LogRatingSection";
import { LogStatusSection } from "./LogStatusSection";

const FORMAT_LABELS: Record<LogFormat, string> = {
  hours: "Hours",
  percent: "Percent",
  pages: "Pages",
};

/** Shared detailed-editing popup for one library item: a flat status list,
 *  then a contextual slot holding only the fields that fit the item's
 *  status group (planned: excitement; in progress: progress + rating;
 *  finished: rating + completed dates + progress), then compact utility
 *  rows (platform for games, notes, remove). Reached from the library
 *  grid's `+` button, list rows, and a Detail page's split status button. */
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
  const [datePrompt, setDatePrompt] = useState<LogCompletionPromptState>(null);
  // Progress edits stay local until the popup closes (unmounts), however it
  // closes: dismiss, the close button, or the trigger unmounting because a
  // status change moved the card. One write means one activity entry.
  const [progressDraft, setProgressDraft] = useState<string | null>(null);
  const pendingProgress = useRef({ item, draft: progressDraft });
  pendingProgress.current = { item, draft: progressDraft };
  useEffect(() => {
    const pending = pendingProgress;
    return () => {
      const { item, draft } = pending.current;
      if (item && draft !== null) void commitProgress(item, draft);
    };
  }, []);

  function handleStatusChange(status: ItemStatus) {
    // Completion statuses defer the actual write until a date is chosen
    // (see commitCompletion) — writing immediately would move the item to
    // a different library-grid section right away, unmounting this popover
    // mid-prompt.
    if (COMPLETION_STATUSES[status]) {
      setDatePrompt({
        status,
        date: todayLocalIsoDate(),
        time: "",
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
    setProgressDraft(null);
    pendingProgress.current.draft = null;
    void item
      .incrementalPatch({ updatedAt: Date.now() })
      .then((doc) => doc.incrementalRemove());
    onClose();
  }

  /** Commits the pending status (set by handleStatusChange, held in
   *  datePrompt.status) together with the chosen completion moment in one
   *  write — the status change and the answer to "when did you finish
   *  it?" land atomically, only once the prompt is answered. `date` is a
   *  `Moment` (an instant for "Just now" or a picked time, else a bare day),
   *  or null for "Unknown date" (status set, nothing recorded). */
  async function commitCompletion(date: Moment | null) {
    const status = datePrompt?.status;
    if (!status) return;
    // Aim the confetti at the button that answered the prompt, read now
    // because the write below can move or unmount this popover.
    const origin = celebrationOrigin(document.activeElement);
    setDatePrompt(null);
    if (item) {
      const doc = await db.library_items
        .findOne(`${target.mediaType}:${target.sourceId}`)
        .exec();
      if (!doc) return;
      // A repeat completion on the same day is still a distinct activity.
      await doc.incrementalModify((current) => ({
        ...current,
        status,
        completions:
          date && !current.completions.includes(date)
            ? [...current.completions, date]
            : current.completions,
        activity: [
          ...current.activity,
          {
            id: randomToken(24),
            at: Date.now(),
            changes: { status, ...(date ? { completions: [date] } : {}) },
          },
        ],
        updatedAt: Date.now(),
      }));
    } else {
      const base = newLibraryItem(target, status);
      await db.library_items.insert({
        ...base,
        completions: date ? [date] : [],
      });
    }
    celebrate(origin);
  }

  function removeCompletionDate(date: string) {
    if (!item) return;
    void item.incrementalModify((docData) => ({
      ...docData,
      completions: docData.completions.filter((d) => d !== date),
      updatedAt: Date.now(),
    }));
  }

  function handleRating(value: number | null) {
    if (!item) return;
    void item.incrementalPatch({ rating: value, updatedAt: Date.now() });
  }

  function handleStorefront(storefront: Storefront | null) {
    if (!item) return;
    void item.incrementalPatch({ storefront, updatedAt: Date.now() });
  }

  function handleExcitement(value: number | null) {
    if (!item) return;
    void item.incrementalPatch({ excitement: value, updatedAt: Date.now() });
  }

  function handleFormatChange(format: LogFormat) {
    if (!item || item.progressFormat === format) return;
    setProgressDraft(null);
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

  const releaseDate = target.releaseDate;

  const progress = (
    <LogProgressSection
      key="progress"
      item={item}
      formats={formats}
      formatLabels={FORMAT_LABELS}
      draft={progressDraft}
      onChangeDraft={setProgressDraft}
      onChangeFormat={handleFormatChange}
    />
  );
  const rating = (
    <LogRatingSection key="rating" item={item} onChange={handleRating} />
  );
  const completionsSection = (
    <LogCompletedDates
      key="completed"
      item={item}
      onRemove={removeCompletionDate}
    />
  );

  // The contextual slot: only the fields that fit the item's status group.
  // Completed dates follow in every group whenever the item has any (the
  // section renders nothing otherwise), so recorded dates stay reachable.
  let contextual: ReactNode[] = [];
  if (item) {
    switch (STATUS_META_GROUP[item.status]) {
      case "planned":
        contextual = [
          <LogExcitementSection
            key="excitement"
            item={item}
            onChange={handleExcitement}
          />,
          completionsSection,
        ];
        break;
      case "in-progress":
        contextual = [progress, rating, completionsSection];
        break;
      case "finished":
        contextual = [rating, completionsSection, progress];
        break;
    }
  }

  return (
    <div data-log-scroll className="flex flex-col gap-3 overflow-y-auto p-3">
      <LogHeader targetName={target.name} onClose={onClose} />
      <LogStatusSection
        statuses={statuses}
        labels={labels}
        activeStatus={datePrompt?.status ?? item?.status ?? null}
        onSelectStatus={handleStatusChange}
      />
      <LogCompletionPrompt
        prompt={datePrompt}
        releaseDate={releaseDate ?? null}
        onSelectToday={() => void commitCompletion(instantMoment())}
        onSelectReleaseDate={() => void commitCompletion(releaseDate ?? null)}
        onChooseOtherDate={(status) =>
          setDatePrompt({
            status: status as ItemStatus,
            date: todayLocalIsoDate(),
            time: "",
            picking: true,
          })
        }
        onDateChange={(date, time) =>
          setDatePrompt((current) =>
            current
              ? {
                  status: current.status,
                  date,
                  time,
                  picking: true,
                }
              : current,
          )
        }
        onCommitDate={(date, time) =>
          // A local date and time read as one local instant.
          void commitCompletion(
            time ? instantMoment(new Date(`${date}T${time}`)) : date,
          )
        }
        onCommitUnknown={() => void commitCompletion(null)}
      />
      {item && (
        <>
          <LogDivider />
          <div className="flex flex-col gap-3">{contextual}</div>
          <LogDivider />
          <div className="flex flex-col gap-0.5">
            <LogPlatformSection
              mediaType={target.mediaType}
              platforms={target.platforms}
              selectedPlatforms={item.platforms}
              onTogglePlatform={togglePlatform}
            />
            <LogStorefrontSection
              mediaType={target.mediaType}
              selectedPlatforms={item.platforms}
              storefront={item.storefront}
              onChange={handleStorefront}
            />
            <LogNotesField item={item} />
            <button
              type="button"
              onClick={handleRemove}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-danger hover:bg-bg"
            >
              <IconTrash />
              Remove from library
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function LogDivider() {
  return <hr className="border-divider" />;
}

async function commitProgress(item: RxDocument<LibraryItem>, draft: string) {
  const latest = item.getLatest();
  if (latest.deleted) return;
  const value = parseProgressDraft(draft, latest.progressFormat);
  if (value === null || value === latest.progressValue) return;
  await latest.incrementalPatch({
    progressValue: value,
    updatedAt: Date.now(),
  });
}
