import type { RxConflictHandler } from "rxdb";
import type { LibraryItem } from "./types.js";

/**
 * Builds a deterministic last-write-wins conflict handler for any collection
 * whose documents carry an `updatedAt`. Resolution is three-tier so every
 * instance converges on the same winner without coordinating:
 *   1. the newer `updatedAt` wins;
 *   2. on a tie, a delete beats a non-delete (so deletes are not resurrected);
 *   3. on a further tie, a stable key comparison decides.
 *
 * The stable key intentionally ignores RxDB's internal fields (`_rev`, `_meta`,
 * `_attachments`) — those differ per instance — while keeping the user fields
 * plus the soft-delete flag.
 */
export function createLwwConflictHandler<
  TDoc extends { updatedAt: number },
>(): RxConflictHandler<TDoc> {
  return {
    isEqual(a, b) {
      return stableKey(a) === stableKey(b);
    },

    async resolve({ realMasterState, newDocumentState }) {
      if (newDocumentState.updatedAt !== realMasterState.updatedAt) {
        return newDocumentState.updatedAt > realMasterState.updatedAt
          ? newDocumentState
          : realMasterState;
      }

      if (newDocumentState._deleted !== realMasterState._deleted) {
        return newDocumentState._deleted ? newDocumentState : realMasterState;
      }

      return stableKey(newDocumentState) >= stableKey(realMasterState)
        ? newDocumentState
        : realMasterState;
    },
  };
}

/**
 * Order-independent serialization of a document's contract fields: keys are
 * sorted (so insertion order is irrelevant) and RxDB internals (`_rev`,
 * `_meta`, …) are dropped, while `_deleted` is kept.
 */
function stableKey(doc: object): string {
  const keys = Object.keys(doc)
    .filter((key) => key === "_deleted" || !key.startsWith("_"))
    .sort();
  return JSON.stringify(doc, keys);
}

export const libraryItemConflictHandler =
  createLwwConflictHandler<LibraryItem>();
