import { describe, expect, it } from "vitest";
import type { ReplicatedLibraryItem } from "@shelfie/shared";
import { pull } from "./pull.js";
import type { SyncCollection } from "./collection.js";

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

function fakeColl(rows: Array<{ doc: ReplicatedLibraryItem; seq: number }>) {
  const calls: Array<{ sinceSeq: number; limit: number }> = [];
  const coll: SyncCollection<ReplicatedLibraryItem> = {
    name: `pull_test_${Math.random().toString(36).slice(2)}`,
    parse: (input) => input as ReplicatedLibraryItem,
    fetchSince: async (sinceSeq, limit) => {
      calls.push({ sinceSeq, limit });
      return rows.filter((r) => r.seq > sinceSeq).slice(0, limit);
    },
    fetchById: async () => null,
    upsert: async () => {},
  };
  return { coll, calls };
}

describe("pull", () => {
  it("uses sinceSeq -1 when checkpoint is null, returns rows in seq order, and checkpoints on the last row", async () => {
    const rows = [
      { doc: { ...base, id: "game:1", updatedAt: 11 }, seq: 1 },
      { doc: { ...base, id: "game:2", updatedAt: 12 }, seq: 2 },
      { doc: { ...base, id: "game:3", updatedAt: 13 }, seq: 3 },
    ];
    const { coll, calls } = fakeColl(rows);

    const res = await pull(coll, { checkpoint: null, batchSize: 100 });

    expect(calls).toEqual([{ sinceSeq: -1, limit: 100 }]);
    expect(res.documents.map((d) => d.id)).toEqual([
      "game:1",
      "game:2",
      "game:3",
    ]);
    expect(res.checkpoint).toEqual({ seq: 3 });
  });

  it("passes the request checkpoint's seq through to fetchSince", async () => {
    const rows = [
      { doc: { ...base, id: "game:6", updatedAt: 16 }, seq: 6 },
      { doc: { ...base, id: "game:7", updatedAt: 17 }, seq: 7 },
    ];
    const { coll, calls } = fakeColl(rows);

    await pull(coll, { checkpoint: { seq: 5 }, batchSize: 100 });

    expect(calls).toEqual([{ sinceSeq: 5, limit: 100 }]);
  });

  it("falls back to a limit of 100 for a zero or negative batchSize", async () => {
    const { coll: collZero, calls: callsZero } = fakeColl([]);
    await pull(collZero, { checkpoint: null, batchSize: 0 });
    expect(callsZero).toEqual([{ sinceSeq: -1, limit: 100 }]);

    const { coll: collNeg, calls: callsNeg } = fakeColl([]);
    await pull(collNeg, { checkpoint: null, batchSize: -5 });
    expect(callsNeg).toEqual([{ sinceSeq: -1, limit: 100 }]);
  });

  it("carries the request checkpoint forward unchanged on an empty page", async () => {
    const rows = [{ doc: { ...base, id: "game:1", updatedAt: 11 }, seq: 1 }];
    const { coll } = fakeColl(rows);

    const res = await pull(coll, { checkpoint: { seq: 5 }, batchSize: 100 });

    expect(res.documents).toEqual([]);
    expect(res.checkpoint).toEqual({ seq: 5 });
  });

  it("returns a null checkpoint when there is no checkpoint and no rows", async () => {
    const { coll } = fakeColl([]);

    const res = await pull(coll, { checkpoint: null, batchSize: 100 });

    expect(res.documents).toEqual([]);
    expect(res.checkpoint).toBeNull();
  });

  it("paginates with batchSize smaller than the row count, checkpointing on the last returned row not the max seq", async () => {
    const rows = [
      { doc: { ...base, id: "game:1", updatedAt: 11 }, seq: 1 },
      { doc: { ...base, id: "game:2", updatedAt: 12 }, seq: 2 },
      { doc: { ...base, id: "game:3", updatedAt: 13 }, seq: 3 },
    ];
    const { coll } = fakeColl(rows);

    const res = await pull(coll, { checkpoint: null, batchSize: 2 });

    expect(res.documents.map((d) => d.id)).toEqual(["game:1", "game:2"]);
    expect(res.checkpoint).toEqual({ seq: 2 });
  });
});
