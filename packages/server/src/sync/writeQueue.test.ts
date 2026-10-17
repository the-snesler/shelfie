import BetterSqlite3 from "better-sqlite3";
import {
  Kysely,
  SqliteDialect,
  type CompiledQuery,
  type QueryResult,
} from "kysely";
import {
  libraryItemDocSchema,
  type ReplicatedLibraryItem,
} from "@shelfie/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations.js";
import { initSequence } from "../db/sequence.js";
import type { Database } from "../db/types.js";
import { ImportService } from "../imports/service.js";
import { mergeImportedItem } from "../imports/merge.js";
import type { SyncCollection } from "./collection.js";
import { pull } from "./pull.js";
import { push } from "./push.js";
import { libraryItemDocToRow, libraryItemRowToDoc } from "./row.js";
import { onChange } from "./stream.js";
import { withCollectionWriteLock } from "./writeQueue.js";

let database: Kysely<Database>;
let gateSelect: (() => Promise<void>) | undefined;
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(async () => {
  gateSelect = undefined;
  database = new Kysely<Database>({
    dialect: new SqliteDialect({
      database: new BetterSqlite3(":memory:"),
      async onCreateConnection(connection) {
        const execute = connection.executeQuery.bind(connection);
        connection.executeQuery = async <R>(
          query: CompiledQuery,
        ): Promise<QueryResult<R>> => {
          const result = await execute<R>(query);
          if (
            gateSelect &&
            query.sql.startsWith('select * from "library_items"') &&
            query.parameters[0] === "movie:2"
          ) {
            const gate = gateSelect;
            gateSelect = undefined;
            await gate();
          }
          return result;
        };
      },
    }),
  });
  await runMigrations(database);
  initSequence("library_items", 0);
});
afterEach(async () => {
  await database.destroy();
});

function collection(): SyncCollection<ReplicatedLibraryItem> {
  return {
    name: "library_items",
    parse: (input) => libraryItemDocSchema.parse(input),
    async fetchById(id) {
      const row = await database
        .selectFrom("library_items")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return row ? libraryItemRowToDoc(row) : null;
    },
    async upsert(doc, seq) {
      const row = libraryItemDocToRow(doc, seq);
      await database
        .insertInto("library_items")
        .values(row)
        .onConflict((oc) => oc.column("id").doUpdateSet(row))
        .execute();
    },
    async fetchSince(seq, limit) {
      const rows = await database
        .selectFrom("library_items")
        .selectAll()
        .where("seq", ">", seq)
        .orderBy("seq")
        .limit(limit)
        .execute();
      return rows.map((row) => ({
        doc: libraryItemRowToDoc(row),
        seq: row.seq,
      }));
    },
  };
}

function doc(id = "2"): ReplicatedLibraryItem {
  return mergeImportedItem(
    { mediaType: "movie", sourceId: id, status: "backlogged" },
    null,
    100,
  )!;
}

async function importService(
  load: ConstructorParameters<typeof ImportService>[1],
) {
  const service = new ImportService(database, load);
  await service.save("trakt", {
    enabled: false,
    schedule: "",
    account: "reader",
    baseUrl: "",
    apiKey: "key",
  });
  return service;
}

describe("serialized collection writes", () => {
  it("never advances a pull past a pending lower-sequence push when an import races its SELECT", async () => {
    const source = Promise.withResolvers<{
      items: Array<{
        mediaType: "movie";
        sourceId: string;
        status: "backlogged";
      }>;
      skipped: number;
      warnings: string[];
    }>();
    const loadingSource = Promise.withResolvers<void>();
    const service = await importService(async () => {
      loadingSource.resolve();
      return source.promise;
    });
    const imported = service.run("trakt");
    await loadingSource.promise;
    const selectEntered = Promise.withResolvers<void>();
    const releaseSelect = Promise.withResolvers<void>();
    gateSelect = async () => {
      selectEntered.resolve();
      await releaseSelect.promise;
    };
    const checkpoints: number[] = [];
    const unsubscribe = onChange("library_items", (event) =>
      checkpoints.push(event.checkpoint.seq),
    );
    try {
      const coll = collection();
      const pushed = push(coll, [
        { newDocumentState: doc(), assumedMasterState: null },
      ]);
      await selectEntered.promise;
      // Without the shared queue, this transaction acquires the connection
      // before the push's upsert and assigns a higher sequence first.
      source.resolve({
        items: [{ mediaType: "movie", sourceId: "1", status: "backlogged" }],
        skipped: 0,
        warnings: [],
      });
      await nextTurn();
      const concurrentPull = pull(coll, { checkpoint: null, batchSize: 100 });
      releaseSelect.resolve();
      const first = await concurrentPull;
      await Promise.all([imported, pushed]);
      const second = await pull(coll, {
        checkpoint: first.checkpoint,
        batchSize: 100,
      });
      expect(
        [...first.documents, ...second.documents].map((item) => item.id).sort(),
      ).toEqual(["movie:1", "movie:2"]);
      expect(checkpoints).toEqual([1, 2]);
    } finally {
      releaseSelect.resolve();
      unsubscribe();
    }
  });

  it.each(["create", "update"] as const)(
    "returns the committed master for a concurrent same-document %s",
    async (operation) => {
      const coll = collection();
      const master = operation === "update" ? doc() : null;
      if (master) {
        await coll.upsert(master, 1);
        initSequence("library_items", 1);
      }
      const first = { ...doc(), notes: "First writer", updatedAt: 200 };
      const second = { ...doc(), notes: "Second writer", updatedAt: 300 };
      const firstRead = Promise.withResolvers<void>();
      const releaseRead = Promise.withResolvers<void>();
      let reads = 0;
      const originalRead = coll.fetchById;
      coll.fetchById = async (id) => {
        const result = await originalRead(id);
        reads++;
        if (reads === 1) {
          firstRead.resolve();
          await releaseRead.promise;
        }
        return result;
      };
      const firstPush = push(coll, [
        { newDocumentState: first, assumedMasterState: master },
      ]);
      await firstRead.promise;
      const secondPush = push(coll, [
        { newDocumentState: second, assumedMasterState: master },
      ]);
      await nextTurn();
      const readsBeforeRelease = reads;
      releaseRead.resolve();
      const results = await Promise.all([firstPush, secondPush]);
      expect(readsBeforeRelease).toBe(1);
      expect(results).toEqual([[], [first]]);
      expect(await originalRead(first.id)).toEqual(first);
    },
  );

  it("continues queued pushes after a write failure", async () => {
    const coll = collection();
    const originalWrite = coll.upsert;
    let fail = true;
    coll.upsert = async (item, seq) => {
      if (fail) {
        fail = false;
        throw new Error("Temporary failure");
      }
      await originalWrite(item, seq);
    };
    const failed = push(coll, [
      { newDocumentState: doc(), assumedMasterState: null },
    ]);
    const recovered = push(coll, [
      { newDocumentState: doc("3"), assumedMasterState: null },
    ]);
    const results = await Promise.allSettled([failed, recovered]);
    expect(results[0].status).toBe("rejected");
    expect(results[1]).toEqual({ status: "fulfilled", value: [] });
    expect(await coll.fetchById("movie:3")).toEqual(doc("3"));
  });

  it("releases the write queue after an import transaction rolls back", async () => {
    const service = await importService(async () => ({
      items: [
        { mediaType: "movie", sourceId: "1", status: "backlogged" },
        { mediaType: "movie", sourceId: "invalid", status: "backlogged" },
      ],
      skipped: 0,
      warnings: [],
    }));
    await expect(service.run("trakt")).rejects.toThrow();
    const coll = collection();
    await expect(
      push(coll, [{ newDocumentState: doc(), assumedMasterState: null }]),
    ).resolves.toEqual([]);
    expect(await coll.fetchById("movie:1")).toBeNull();
    expect(await coll.fetchById("movie:2")).toEqual(doc());
  });

  it("keeps unrelated collection queues independent", async () => {
    const release = Promise.withResolvers<void>();
    const first = withCollectionWriteLock("first", async () => {
      await release.promise;
    });
    const other = await withCollectionWriteLock("other", async () => "done");
    release.resolve();
    await first;
    expect(other).toBe("done");
  });
});
