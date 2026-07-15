import type { Checkpoint } from "@shelfie/shared";
import type { RxCollection, RxReplicationPullStreamItem } from "rxdb";
import { replicateRxCollection } from "rxdb/plugins/replication";
import { Subject } from "rxjs";
import { authFetch, authUrl } from "../auth";

// One replication per collection name; guard against React re-renders
// starting duplicates (each would open a second SSE connection).
const started = new Map<
  string,
  { events: EventSource; state: { cancel?: () => void | Promise<void> } }
>();

export function stopReplication(): void {
  for (const { events, state } of started.values()) {
    events.close();
    void state.cancel?.();
  }
  started.clear();
}

/**
 * Wires a collection to the server's pull/push/stream endpoints under
 * `/api/sync/<name>/*`:
 * - pull.handler fetches changes since the last checkpoint.
 * - pull.stream$ is fed by an SSE connection so a second instance updates live.
 * - push.handler ships local changes and returns any conflicts.
 *
 * The same protocol drives every collection — only the `name` (route segment
 * + replication identifier) differs.
 */
export function startReplication<TDoc>(options: {
  collection: RxCollection<TDoc>;
  name: string;
}): void {
  const { collection, name } = options;
  if (started.has(name)) return;

  type PullStreamItem = RxReplicationPullStreamItem<TDoc, Checkpoint>;
  const pullStream$ = new Subject<PullStreamItem>();

  const events = new EventSource(authUrl(`/api/sync/${name}/stream`));
  events.onmessage = (event) => {
    if (!event.data) return;
    pullStream$.next(JSON.parse(event.data) as PullStreamItem);
  };
  events.onerror = () => {
    // Connection dropped/reconnecting — tell RxDB to resync from its checkpoint.
    pullStream$.next("RESYNC");
  };

  const state = replicateRxCollection<TDoc, Checkpoint>({
    collection,
    replicationIdentifier: `shelfie-${name}-http`,
    live: true,
    retryTime: 5000,
    pull: {
      async handler(checkpoint, batchSize) {
        const res = await authFetch(`/api/sync/${name}/pull`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ checkpoint: checkpoint ?? null, batchSize }),
        });
        if (!res.ok) throw new Error(`pull failed: ${res.status}`);
        return res.json();
      },
      stream$: pullStream$.asObservable(),
    },
    push: {
      async handler(rows) {
        const res = await authFetch(`/api/sync/${name}/push`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(rows),
        });
        if (!res.ok) throw new Error(`push failed: ${res.status}`);
        return res.json();
      },
    },
  });
  started.set(name, {
    events,
    state: state as unknown as { cancel?: () => void | Promise<void> },
  });
}
