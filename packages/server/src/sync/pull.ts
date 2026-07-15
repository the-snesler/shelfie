import type { Checkpoint } from "@shelfie/shared";
import type { ReplicatedDoc, SyncCollection } from "./collection.js";

export interface PullRequest {
  checkpoint: Checkpoint | null;
  batchSize: number;
}

export interface PullResponse<TDoc> {
  documents: TDoc[];
  checkpoint: Checkpoint | null;
}

/**
 * Returns documents changed since the client's checkpoint, ordered by
 * server-assigned seq so client clock skew cannot affect sync ordering.
 */
export async function pull<TDoc extends ReplicatedDoc>(
  coll: SyncCollection<TDoc>,
  req: PullRequest,
): Promise<PullResponse<TDoc>> {
  const cp = req.checkpoint;
  const limit = req.batchSize > 0 ? req.batchSize : 100;
  // -1 sentinel: with no checkpoint the first pull returns every row (seq ≥ 0).
  const sinceSeq = cp ? cp.seq : -1;

  const rows = await coll.fetchSince(sinceSeq, limit);
  const documents = rows.map((row) => row.doc);
  const last = rows[rows.length - 1];
  const checkpoint: Checkpoint | null = last ? { seq: last.seq } : cp;

  return { documents, checkpoint };
}
