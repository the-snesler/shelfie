import type { Checkpoint } from "@shelfie/shared";
import { EventEmitter } from "node:events";

export interface SyncEvent {
  documents: unknown[];
  checkpoint: Checkpoint;
}

/**
 * In-process fan-out from push handlers to open SSE connections. Single
 * container, single process, so an EventEmitter is all the pub/sub we need.
 * Events are namespaced by collection name so each collection's stream only
 * receives its own changes.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function emitChange(collection: string, event: SyncEvent): void {
  emitter.emit(collection, event);
}

/** Subscribe to one collection's changes; returns an unsubscribe function. */
export function onChange(
  collection: string,
  listener: (event: SyncEvent) => void,
): () => void {
  emitter.on(collection, listener);
  return () => emitter.off(collection, listener);
}
