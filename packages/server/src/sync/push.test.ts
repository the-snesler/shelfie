import { describe, expect, it } from "vitest";
import {
  libraryItemDocSchema,
  type ReplicatedLibraryItem,
} from "@shelfie/shared";
import type { SyncCollection } from "./collection.js";
import { push, type PushRow } from "./push.js";
import { onChange, type SyncEvent } from "./stream.js";

const base: ReplicatedLibraryItem = {
  id: "game:1942",
  mediaType: "game",
  sourceId: "1942",
  status: "active",
  progressFormat: "hours",
  progressValue: 10,
  addedAt: 1,
  updatedAt: 10,
  platforms: [],
  rating: null,
  completedDates: [],
  notes: "",
  watchedEpisodes: {},
  _deleted: false,
};

function uniqueName(): string {
  return `push_test_${Math.random().toString(36).slice(2)}`;
}

interface FakeCollection extends SyncCollection<ReplicatedLibraryItem> {
  store: Map<string, { doc: ReplicatedLibraryItem; seq: number }>;
  upsertCalls: Array<{ doc: ReplicatedLibraryItem; seq: number }>;
}

/** Hand-rolled in-memory stand-in for a real sync collection. */
function makeCollection(
  name: string,
  parse: (input: unknown) => ReplicatedLibraryItem = (input) =>
    input as ReplicatedLibraryItem,
): FakeCollection {
  const store = new Map<string, { doc: ReplicatedLibraryItem; seq: number }>();
  const upsertCalls: Array<{ doc: ReplicatedLibraryItem; seq: number }> = [];
  return {
    name,
    store,
    upsertCalls,
    parse,
    async fetchSince() {
      return [];
    },
    async fetchById(id) {
      return store.get(id)?.doc ?? null;
    },
    async upsert(doc, seq) {
      upsertCalls.push({ doc, seq });
      store.set(doc.id, { doc, seq });
    },
  };
}

/** Subscribes to a collection's stream and records every emitted event. */
function collectEvents(name: string): {
  events: SyncEvent[];
  stop: () => void;
} {
  const events: SyncEvent[] = [];
  const stop = onChange(name, (event) => {
    events.push(event);
  });
  return { events, stop };
}

describe("push", () => {
  it("upserts a brand-new document and emits one event carrying the assigned seq", async () => {
    const coll = makeCollection(uniqueName());
    const { events, stop } = collectEvents(coll.name);
    try {
      const rows: PushRow<ReplicatedLibraryItem>[] = [
        { newDocumentState: base, assumedMasterState: undefined },
      ];
      const conflicts = await push(coll, rows);

      expect(conflicts).toEqual([]);
      expect(coll.upsertCalls).toHaveLength(1);
      const seq = coll.upsertCalls[0].seq;
      expect(coll.store.get(base.id)?.doc).toEqual(base);

      expect(events).toHaveLength(1);
      expect(events[0].documents).toEqual([base]);
      expect(events[0].checkpoint.seq).toBe(seq);
    } finally {
      stop();
    }
  });

  it("upserts an update whose assumed master matches the stored master, with a strictly higher seq", async () => {
    const coll = makeCollection(uniqueName());
    const { events, stop } = collectEvents(coll.name);
    try {
      const firstConflicts = await push(coll, [
        { newDocumentState: base, assumedMasterState: undefined },
      ]);
      expect(firstConflicts).toEqual([]);
      const firstSeq = coll.upsertCalls[0].seq;

      const updated: ReplicatedLibraryItem = {
        ...base,
        progressValue: 20,
        updatedAt: 20,
      };
      const secondConflicts = await push(coll, [
        { newDocumentState: updated, assumedMasterState: base },
      ]);

      expect(secondConflicts).toEqual([]);
      expect(coll.upsertCalls).toHaveLength(2);
      const secondSeq = coll.upsertCalls[1].seq;
      expect(secondSeq).toBeGreaterThan(firstSeq);
      expect(coll.store.get(base.id)?.doc).toEqual(updated);

      expect(events).toHaveLength(2);
      expect(events[1].checkpoint.seq).toBe(secondSeq);
    } finally {
      stop();
    }
  });

  it("returns the stored master as a conflict when assumed state mismatches, without writing or emitting", async () => {
    const coll = makeCollection(uniqueName());
    const { events, stop } = collectEvents(coll.name);
    try {
      await push(coll, [
        { newDocumentState: base, assumedMasterState: undefined },
      ]);
      expect(coll.upsertCalls).toHaveLength(1);

      const staleAssumed: ReplicatedLibraryItem = {
        ...base,
        progressValue: 999,
      };
      const clientNew: ReplicatedLibraryItem = {
        ...base,
        progressValue: 5,
        updatedAt: 30,
      };
      const conflicts = await push(coll, [
        { newDocumentState: clientNew, assumedMasterState: staleAssumed },
      ]);

      expect(conflicts).toEqual([base]);
      expect(coll.upsertCalls).toHaveLength(1);
      expect(events).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it("returns a conflict on a create/create race when a master already exists", async () => {
    const coll = makeCollection(uniqueName());
    const { events, stop } = collectEvents(coll.name);
    try {
      await push(coll, [
        { newDocumentState: base, assumedMasterState: undefined },
      ]);
      expect(coll.upsertCalls).toHaveLength(1);

      const raceDoc: ReplicatedLibraryItem = { ...base, progressValue: 42 };
      const conflicts = await push(coll, [
        { newDocumentState: raceDoc, assumedMasterState: null },
      ]);

      expect(conflicts).toEqual([base]);
      expect(coll.upsertCalls).toHaveLength(1);
      expect(events).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it("in a mixed batch writes only the clean row and emits an event for it alone", async () => {
    const coll = makeCollection(uniqueName());
    const { events, stop } = collectEvents(coll.name);
    try {
      const other: ReplicatedLibraryItem = {
        ...base,
        id: "game:99",
        sourceId: "99",
      };
      await push(coll, [
        { newDocumentState: other, assumedMasterState: undefined },
      ]);
      expect(coll.upsertCalls).toHaveLength(1);

      const cleanWrite: ReplicatedLibraryItem = {
        ...base,
        progressValue: 15,
        updatedAt: 15,
      };
      const conflictingAssumed: ReplicatedLibraryItem = {
        ...other,
        progressValue: 1,
      };
      const conflictingNew: ReplicatedLibraryItem = {
        ...other,
        progressValue: 2,
        updatedAt: 20,
      };

      const conflicts = await push(coll, [
        { newDocumentState: cleanWrite, assumedMasterState: null },
        {
          newDocumentState: conflictingNew,
          assumedMasterState: conflictingAssumed,
        },
      ]);

      expect(conflicts).toEqual([other]);
      expect(coll.upsertCalls).toHaveLength(2);
      const writtenSeq = coll.upsertCalls[1].seq;

      expect(events).toHaveLength(2);
      const mixedEvent = events[1];
      expect(mixedEvent.documents).toEqual([cleanWrite]);
      expect(mixedEvent.checkpoint.seq).toBe(writtenSeq);
    } finally {
      stop();
    }
  });

  it("rejects an invalid document at the zod boundary and writes nothing", async () => {
    const coll = makeCollection(uniqueName(), (input) =>
      libraryItemDocSchema.parse(input),
    );
    const invalid: ReplicatedLibraryItem = { ...base, rating: 99 };

    await expect(
      push(coll, [
        { newDocumentState: invalid, assumedMasterState: undefined },
      ]),
    ).rejects.toThrow();

    expect(coll.upsertCalls).toHaveLength(0);
    expect(coll.store.size).toBe(0);
  });

  it("assigns strictly increasing seqs across sequential successful pushes", async () => {
    const coll = makeCollection(uniqueName());
    const { events, stop } = collectEvents(coll.name);
    try {
      const docs = [0, 1, 2].map((i) => ({
        ...base,
        id: `game:${1942 + i}`,
        sourceId: String(1942 + i),
      }));

      for (const doc of docs) {
        const conflicts = await push(coll, [
          { newDocumentState: doc, assumedMasterState: undefined },
        ]);
        expect(conflicts).toEqual([]);
      }

      expect(events).toHaveLength(3);
      const seqs = events.map((event) => event.checkpoint.seq);
      expect(seqs[1]).toBeGreaterThan(seqs[0]);
      expect(seqs[2]).toBeGreaterThan(seqs[1]);
    } finally {
      stop();
    }
  });
});
