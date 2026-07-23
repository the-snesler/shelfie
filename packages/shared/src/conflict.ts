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
      return canonicalDocKey(a) === canonicalDocKey(b);
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

      return canonicalDocKey(newDocumentState) >=
        canonicalDocKey(realMasterState)
        ? newDocumentState
        : realMasterState;
    },
  };
}

/**
 * Order-independent serialization of a document's contract fields: object
 * keys are sorted recursively (so key insertion order and nested map order
 * are irrelevant), arrays keep their order, and RxDB internals (`_rev`,
 * `_meta`, `_attachments`) are dropped while `_deleted` is kept.
 */
export function canonicalDocKey(doc: object): string {
  return JSON.stringify(canonicalize(doc));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (key.startsWith("_") && key !== "_deleted") continue;
      out[key] = canonicalize(obj[key]);
    }
    return out;
  }
  return value;
}

export const libraryItemConflictHandler =
  createLwwConflictHandler<LibraryItem>();
