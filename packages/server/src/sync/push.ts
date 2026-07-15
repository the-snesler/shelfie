import { nextRev } from "../db/sequence.js";
import {
  equalDocs,
  type ReplicatedDoc,
  type SyncCollection,
} from "./collection.js";
import { emitChange } from "./stream.js";

export interface PushRow<TDoc> {
  newDocumentState: TDoc;
  assumedMasterState?: TDoc | null;
}

/**
 * Applies a batch of client changes. For each row we compare the real current
 * master state against what the client assumed; on mismatch we return the real
 * state as a conflict (RxDB resolves and re-pushes). Otherwise we assign a
 * server seq and upsert. The array of conflicting master documents is the
 * response RxDB expects.
 */
export async function push<TDoc extends ReplicatedDoc>(
  coll: SyncCollection<TDoc>,
  rows: PushRow<TDoc>[],
): Promise<TDoc[]> {
  const conflicts: TDoc[] = [];
  const written: Array<{ doc: TDoc; seq: number }> = [];

  for (const row of rows) {
    const doc = coll.parse(row.newDocumentState);
    const realMaster = await coll.fetchById(doc.id);

    if (!equalDocs(realMaster, row.assumedMasterState ?? null)) {
      if (realMaster) conflicts.push(realMaster);
      continue;
    }

    const seq = nextRev(coll.name);
    await coll.upsert(doc, seq);
    written.push({ doc, seq });
  }

  if (written.length > 0) {
    const latestSeq = Math.max(...written.map((entry) => entry.seq));
    emitChange(coll.name, {
      documents: written.map((entry) => entry.doc),
      checkpoint: { seq: latestSeq },
    });
  }

  return conflicts;
}
