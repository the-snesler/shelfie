import type { ItemStatus } from "@shelfie/shared";

export type LogCompletionPromptState = {
  status: ItemStatus;
  date: string;
  picking: boolean;
} | null;

export function LogCompletionPrompt({
  prompt,
  releaseDate,
  onSelectToday,
  onSelectReleaseDate,
  onChooseOtherDate,
  onDateChange,
  onCommitDate,
  onCommitUnknown,
}: {
  prompt: LogCompletionPromptState;
  releaseDate: string | null;
  onSelectToday: () => void;
  onSelectReleaseDate: () => void;
  onChooseOtherDate: (status: ItemStatus) => void;
  onDateChange: (date: string) => void;
  onCommitDate: (date: string) => void;
  onCommitUnknown: () => void;
}) {
  if (!prompt) return null;

  return (
    <div className="flex flex-col gap-3 rounded border border-divider bg-bg p-4">
      <p className="text-sm font-medium text-ink">When did you finish it?</p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onSelectToday}
          className="rounded bg-bg px-3 py-1.5 text-sm text-ink ring-1 ring-divider"
        >
          Just now
        </button>
        {releaseDate && (
          <button
            type="button"
            onClick={onSelectReleaseDate}
            className="rounded bg-bg px-3 py-1.5 text-sm text-ink ring-1 ring-divider"
          >
            Release date
          </button>
        )}
        <button
          type="button"
          onClick={() => onChooseOtherDate(prompt.status)}
          className="rounded bg-bg px-3 py-1.5 text-sm text-ink ring-1 ring-divider"
        >
          Other date…
        </button>
        <button
          type="button"
          onClick={onCommitUnknown}
          className="rounded px-3 py-1.5 text-sm text-muted hover:text-ink"
        >
          Unknown date
        </button>
      </div>
      {prompt.picking && (
        <>
          <input
            type="date"
            value={prompt.date}
            onChange={(event) => onDateChange(event.target.value)}
            className="rounded bg-panel px-3 py-2 text-ink ring-1 ring-divider"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onCommitDate(prompt.date)}
              className="rounded bg-accent px-3 py-1 text-sm font-medium text-accent-ink"
            >
              Add date
            </button>
          </div>
        </>
      )}
    </div>
  );
}
