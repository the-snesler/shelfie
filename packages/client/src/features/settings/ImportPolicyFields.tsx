import {
  IMPORT_BUCKETS,
  type ImportBucket,
  type ImportPolicy,
  type ImportSource,
  type MediaType,
} from "@tsundo/shared";
import { inputClass } from "./importRequest";

export const BUCKET_LABELS: Record<ImportBucket, string> = {
  completed: "Completed",
  inProgress: "In progress",
  backlog: "Backlog",
  wishlist: "Wishlist",
  dropped: "Dropped",
};

/** What each bucket means in a source's own terms. */
export const BUCKET_HINTS: Record<
  ImportSource,
  Partial<Record<ImportBucket, string>>
> = {
  steam: {
    inProgress: "games with playtime",
    backlog: "owned, never played",
  },
  trakt: {
    completed: "watched movies",
    inProgress:
      "shows with watch history; finished seasons are marked watched afterwards",
    backlog: "watchlist",
  },
  bookorbit: {
    completed: "read or skimmed",
    inProgress: "reading or on hold",
    backlog: "unread",
    wishlist: "want to read",
    dropped: "abandoned",
  },
};

const MEDIA_LABELS: Record<MediaType, string> = {
  game: "Games",
  movie: "Movies",
  tv: "TV shows",
  book: "Books",
};

const checkboxLabel = "flex items-start gap-2 text-sm text-ink";

export function ImportPolicyFields({
  policy,
  onChange,
  buckets = IMPORT_BUCKETS,
  mediaTypes = [],
  hints = {},
}: {
  policy: ImportPolicy;
  onChange: (policy: ImportPolicy) => void;
  /** Buckets the source can report; others are not offered. */
  buckets?: readonly ImportBucket[];
  /** Offered only when a source reports more than one. */
  mediaTypes?: readonly MediaType[];
  hints?: Partial<Record<ImportBucket, string>>;
}) {
  const set = (patch: Partial<ImportPolicy>) =>
    onChange({ ...policy, ...patch });
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-muted">
          Import entries that are
        </legend>
        {buckets.map((bucket) => (
          <label key={bucket} className={checkboxLabel}>
            <input
              type="checkbox"
              className="mt-1"
              checked={policy.buckets[bucket]}
              onChange={(event) =>
                set({
                  buckets: {
                    ...policy.buckets,
                    [bucket]: event.currentTarget.checked,
                  },
                })
              }
            />
            <span>
              {BUCKET_LABELS[bucket]}
              {hints[bucket] && (
                <span className="text-muted"> · {hints[bucket]}</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      {mediaTypes.length > 1 && (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
          <legend className="mb-1 text-sm text-muted">Media types</legend>
          {mediaTypes.map((mediaType) => (
            <label key={mediaType} className={checkboxLabel}>
              <input
                type="checkbox"
                className="mt-1"
                checked={policy.mediaTypes.includes(mediaType)}
                onChange={(event) =>
                  set({
                    mediaTypes: event.currentTarget.checked
                      ? [...policy.mediaTypes, mediaType]
                      : policy.mediaTypes.filter((type) => type !== mediaType),
                  })
                }
              />
              {MEDIA_LABELS[mediaType]}
            </label>
          ))}
        </fieldset>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm text-muted">On each import</legend>
        <label className={checkboxLabel}>
          <input
            type="checkbox"
            className="mt-1"
            checked={policy.addNew}
            onChange={(event) => set({ addNew: event.currentTarget.checked })}
          />
          Add items that aren't in your library yet
        </label>
        <label className={checkboxLabel}>
          <input
            type="checkbox"
            className="mt-1"
            checked={policy.updateExisting}
            onChange={(event) =>
              set({ updateExisting: event.currentTarget.checked })
            }
          />
          <span>
            Update items already in your library
            <span className="block text-xs text-muted">
              Fills in ratings, completion dates, watched episodes, and
              progress.
            </span>
          </span>
        </label>
        <label className={`${checkboxLabel} ml-6`}>
          <input
            type="checkbox"
            className="mt-1"
            disabled={!policy.updateExisting}
            checked={policy.updateExisting && policy.updateStatuses}
            onChange={(event) =>
              set({ updateStatuses: event.currentTarget.checked })
            }
          />
          <span>
            Change their status when it changes in the source
            <span className="block text-xs text-muted">
              Only moves forward, for example from backlog to in progress to
              completed, and never changes completed or dropped items. When off,
              the source only sets the status of new items.
            </span>
          </span>
        </label>
      </fieldset>
      <label className="text-sm text-muted">
        Skip entries with no activity since (optional)
        <input
          className={inputClass}
          type="date"
          value={policy.since ?? ""}
          onChange={(event) =>
            set({ since: event.currentTarget.value || null })
          }
        />
        <span className="mt-1 block text-xs">
          Entries without a date, like never-played Steam games, are always
          considered.
        </span>
      </label>
    </div>
  );
}
