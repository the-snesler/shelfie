import {
  IMPORT_SOURCES,
  type ImportConnection,
  type ImportSource,
  type ImportResult,
  type ImportConnectionInput,
  type ReplicatedLibraryItem,
} from "@shelfie/shared";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { Database, ImportConnectionsTable } from "../db/types.js";
import { nextRev } from "../db/sequence.js";
import { libraryItemDocToRow, libraryItemRowToDoc } from "../sync/row.js";
import { emitChange } from "../sync/stream.js";
import { withCollectionWriteLock } from "../sync/writeQueue.js";
import { parseCron } from "./cron.js";
import { mergeImportedItem } from "./merge.js";
import { fetchSource } from "./sources.js";

const inputSchema = z
  .object({
    enabled: z.boolean(),
    schedule: z.string().trim().max(100),
    account: z.string().trim().max(200),
    baseUrl: z.string().trim().max(2000),
    apiKey: z.string().trim().max(2000).optional(),
    accessToken: z.string().trim().max(4000).optional(),
  })
  .strict();

export function publicConnection(
  row: ImportConnectionsTable,
): ImportConnection {
  return {
    source: row.source as ImportSource,
    enabled: row.enabled === 1,
    schedule: row.schedule,
    account: row.account,
    baseUrl: row.base_url,
    hasApiKey: !!row.api_key,
    hasAccessToken: !!row.access_token,
    running: row.running === 1,
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
    lastResult: row.last_result
      ? (JSON.parse(row.last_result) as ImportResult)
      : null,
  };
}

function emptyConnection(source: ImportSource): ImportConnectionsTable {
  return {
    source,
    enabled: 0,
    schedule: "",
    account: "",
    base_url: "",
    api_key: "",
    access_token: "",
    running: 0,
    last_slot: null,
    last_run_at: null,
    last_error: null,
    last_result: null,
  };
}

export class ImportService {
  private busy = false;
  private stopping = false;
  private idleWaiters: Array<() => void> = [];
  constructor(
    private readonly database: Kysely<Database>,
    private readonly loadSource: typeof fetchSource = fetchSource,
  ) {}

  get isRunning(): boolean {
    return this.busy;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (!this.busy) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  async disconnect(source: ImportSource): Promise<void> {
    if (this.busy) throw new Error("Wait for the current import to finish.");
    await this.database
      .deleteFrom("import_connections")
      .where("source", "=", source)
      .execute();
  }

  async list(): Promise<ImportConnection[]> {
    const rows = await this.database
      .selectFrom("import_connections")
      .selectAll()
      .execute();
    return IMPORT_SOURCES.map((source) =>
      publicConnection(
        rows.find((row) => row.source === source) ?? emptyConnection(source),
      ),
    );
  }

  async save(
    source: ImportSource,
    input: ImportConnectionInput,
  ): Promise<ImportConnection> {
    const parsed = inputSchema.parse(input);
    if (parsed.schedule) parseCron(parsed.schedule);
    const current =
      (await this.database
        .selectFrom("import_connections")
        .selectAll()
        .where("source", "=", source)
        .executeTakeFirst()) ?? emptyConnection(source);
    if (current.running)
      throw new Error(
        "Wait for the current import to finish before changing this connection.",
      );
    const row = {
      ...current,
      enabled: parsed.enabled ? 1 : 0,
      schedule: parsed.schedule,
      account: parsed.account,
      base_url: parsed.baseUrl.replace(/\/+$/, ""),
      api_key: parsed.apiKey ?? current.api_key,
      access_token: parsed.accessToken ?? current.access_token,
    };
    if (source === "steam" && (!/^\d{17}$/.test(row.account) || !row.api_key))
      throw new Error("Steam needs a 17-digit SteamID64 and Web API key.");
    if (
      source === "trakt" &&
      (!/^[a-zA-Z0-9_-]+$/.test(row.account) || !row.api_key)
    )
      throw new Error("Trakt needs a profile slug and API client ID.");
    if (source === "bookorbit") {
      let url: URL;
      try {
        url = new URL(row.base_url);
      } catch (error) {
        throw new Error("Enter the BookOrbit server URL.", { cause: error });
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !row.access_token
      )
        throw new Error(
          "BookOrbit needs an HTTP(S) server URL and bearer token.",
        );
    }
    await this.database
      .insertInto("import_connections")
      .values(row)
      .onConflict((oc) => oc.column("source").doUpdateSet(row))
      .execute();
    return publicConnection(row);
  }

  /** Claims synchronously in SQLite; only one source job runs at a time. */
  async run(source: ImportSource, slot?: number): Promise<ImportResult> {
    if (this.stopping) throw new Error("Server is shutting down.");
    if (this.busy) throw new Error("Another import is already running.");
    this.busy = true;
    let claimed = false;
    try {
      const query = this.database
        .updateTable("import_connections")
        .set({
          running: 1,
          last_run_at: Date.now(),
          last_error: null,
          ...(slot === undefined ? {} : { last_slot: slot }),
        })
        .where("source", "=", source)
        .where("running", "=", 0);
      const claim = await query.executeTakeFirst();
      if (Number(claim.numUpdatedRows) !== 1)
        throw new Error(
          "Save the source connection first, or wait for its running import.",
        );
      claimed = true;
      const row = await this.database
        .selectFrom("import_connections")
        .selectAll()
        .where("source", "=", source)
        .executeTakeFirstOrThrow();
      const data = await this.loadSource(source, {
        account: row.account,
        baseUrl: row.base_url,
        apiKey: row.api_key,
        accessToken: row.access_token,
      });
      const result: ImportResult = {
        added: 0,
        updated: 0,
        skipped: data.skipped,
        warnings: data.warnings.slice(0, 20),
      };
      const written: ReplicatedLibraryItem[] = [];
      let latestSeq = 0;
      // Fetching sources stays outside the write queue. Only the library
      // transaction and its checkpoint publication serialize with client pushes.
      await withCollectionWriteLock("library_items", async () => {
        // One transaction: malformed rows cannot leave a partially imported library.
        await this.database.transaction().execute(async (trx) => {
          for (const item of data.items) {
            const id = `${item.mediaType}:${item.sourceId}`;
            const existing = await trx
              .selectFrom("library_items")
              .selectAll()
              .where("id", "=", id)
              .executeTakeFirst();
            const doc = mergeImportedItem(
              item,
              existing ? libraryItemRowToDoc(existing) : null,
              Date.now(),
            );
            if (!doc) {
              result.skipped++;
              continue;
            }
            const seq = nextRev("library_items");
            const record = libraryItemDocToRow(doc, seq);
            await trx
              .insertInto("library_items")
              .values(record)
              .onConflict((oc) => oc.column("id").doUpdateSet(record))
              .execute();
            if (existing) result.updated++;
            else result.added++;
            written.push(doc);
            latestSeq = seq;
          }
        });
        if (written.length)
          emitChange("library_items", {
            documents: written,
            checkpoint: { seq: latestSeq },
          });
      });
      await this.database
        .updateTable("import_connections")
        .set({
          running: 0,
          last_result: JSON.stringify(result),
          last_error: null,
        })
        .where("source", "=", source)
        .execute();
      return result;
    } catch (error) {
      if (claimed)
        await this.database
          .updateTable("import_connections")
          .set({
            running: 0,
            last_error:
              error instanceof Error &&
              /^(Steam|Trakt|BookOrbit|Source|IGDB)/.test(error.message)
                ? error.message.slice(0, 500)
                : "Import failed. Check source connectivity and credentials, then try again.",
          })
          .where("source", "=", source)
          .execute();
      throw error;
    } finally {
      this.busy = false;
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  async tick(now = new Date()): Promise<void> {
    if (this.busy || this.stopping) return;
    const slot = Math.floor(now.getTime() / 60_000);
    const rows = await this.database
      .selectFrom("import_connections")
      .selectAll()
      .where("enabled", "=", 1)
      .where("running", "=", 0)
      .execute();
    for (const row of rows) {
      if (
        !row.schedule ||
        row.last_slot === slot ||
        !parseCron(row.schedule)(now)
      )
        continue;
      await this.run(row.source as ImportSource, slot).catch(() => {});
    }
  }

  async resetInterrupted(): Promise<void> {
    await this.database
      .updateTable("import_connections")
      .set({
        running: 0,
        last_error:
          "Import interrupted by a server restart. Run it again or wait for the next scheduled time.",
      })
      .where("running", "=", 1)
      .execute();
  }
}
