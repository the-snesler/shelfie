import { canonicalDocKey } from "@shelfie/shared";

/**
 * The generic sync contract. `pull`/`push` orchestrate replication against any
 * collection through this interface; the table-specific SQL lives in each
 * collection's own descriptor (sync/library-items.ts) so Kysely stays
 * concretely typed and there is no dynamic-table-name guesswork.
 */

/** The minimum a synced wire document carries: an id, a clock, and the soft-delete flag. */
export interface ReplicatedDoc {
  id: string;
  updatedAt: number;
  _deleted: boolean;
}

export interface SyncCollection<TDoc extends ReplicatedDoc> {
  /** Seq/stream namespace and the `:collection` route segment, e.g. "library_items". */
  readonly name: string;
  /** Validate an untrusted wire document at the push boundary (zod). */
  parse(input: unknown): TDoc;
  /** Documents with seq > `sinceSeq`, ordered by seq asc, capped at `limit`. */
  fetchSince(
    sinceSeq: number,
    limit: number,
  ): Promise<Array<{ doc: TDoc; seq: number }>>;
  /** The current master state for an id, or null if absent. */
  fetchById(id: string): Promise<TDoc | null>;
  /** Insert or replace the document at the given server-assigned seq. */
  upsert(doc: TDoc, seq: number): Promise<void>;
}

/**
 * Master-equality used for conflict detection: do two states agree on their
 * contract fields? Compared via an order-independent key that drops RxDB
 * internals (`_rev`, `_meta`, `_attachments`) so a stray internal field on the
 * client's assumed state cannot manufacture a phantom conflict, while keeping
 * `_deleted`.
 */
export function equalDocs(
  a: ReplicatedDoc | null,
  b: ReplicatedDoc | null,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return canonicalDocKey(a) === canonicalDocKey(b);
}
