import {
  DEFAULT_IMPORT_POLICY,
  IMPORT_SOURCES,
  importBucket,
  type BookLinkSource,
  type ImportBookLink,
  type ImportBucket,
  type ImportConnection,
  type ImportPolicy,
  type ImportPreview,
  type ImportPreviewGroup,
  type ImportSource,
  type ImportResult,
  type ImportConnectionInput,
  type ReplicatedLibraryItem,
} from "@tsundo/shared";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { Database, ImportConnectionsTable } from "../db/types.js";
import { nextRev } from "../db/sequence.js";
import { libraryItemDocToRow, libraryItemRowToDoc } from "../sync/row.js";
import { emitChange } from "../sync/stream.js";
import { runTvProgressPass } from "../tv/progress.js";
import { withCollectionWriteLock } from "../sync/writeQueue.js";
import { parseCron } from "./cron.js";
import {
  GoodreadsBookMatcher,
  listBookLinks,
  resetBookLink,
  setBookLink,
} from "./bookLinks.js";
import { mergeImportedItem } from "./merge.js";
import { entryFilter, importPolicySchema, readPolicy } from "./policy.js";
import { IMPORT_ADAPTERS, fetchSource, sourceDefaults } from "./sources.js";
import type {
  EntryFilter,
  ImportedItem,
  SourceConfig,
  SourceData,
} from "./types.js";

export type SourceLoader = (
  source: ImportSource,
  config: SourceConfig,
  wants: EntryFilter,
) => Promise<SourceData>;

/** Runs after a successful import with the imported TV item ids. */
export type TvProgressHook = (
  database: Kysely<Database>,
  itemIds: string[],
) => Promise<unknown>;

/** A large import may bring hundreds of shows with no cached card yet. */
const IMPORT_TV_REFRESH_LIMIT = 300;

const defaultTvProgress: TvProgressHook = (database, itemIds) =>
  runTvProgressPass(database, {
    itemIds,
    refreshLimit: IMPORT_TV_REFRESH_LIMIT,
  });

const inputSchema = z
  .object({
    enabled: z.boolean(),
    schedule: z.string().trim().max(100),
    account: z.string().trim().max(200),
    baseUrl: z.string().trim().max(2000),
    apiKey: z.string().trim().max(2000).optional(),
    accessToken: z.string().trim().max(4000).optional(),
    policy: importPolicySchema.nullable().optional(),
  })
  .strict();

const DEFAULTS_ID = "default";
const PREVIEW_SAMPLES = 8;

/** `import_connections.running`: which job holds the source. */
const IDLE = 0;
const IMPORTING = 1;
const PREVIEWING = 2;
type JobState = typeof IMPORTING | typeof PREVIEWING;

/** What applying a source's items under a policy does, before writing. */
interface ImportPlan {
  /** Keyed by item id: two source entries can resolve to the same title. */
  writes: Map<
    string,
    { doc: ReplicatedLibraryItem; existed: boolean; item: ImportedItem }
  >;
  /** The source status of every item the policy let through, for the ledger. */
  seen: Map<string, string>;
  /** Items already up to date, or deleted in the library. */
  unchanged: number;
  filtered: number;
  /** TV items in the library after the import, for the progress check. */
  tvIds: Set<string>;
}

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
    policy: readPolicy(row.policy),
    running: row.running === IMPORTING,
    previewing: row.running === PREVIEWING,
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
    lastResult: row.last_result
      ? (JSON.parse(row.last_result) as ImportResult)
      : null,
    lastPreview: row.last_preview
      ? (JSON.parse(row.last_preview) as ImportPreview)
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
    running: IDLE,
    last_slot: null,
    last_run_at: null,
    last_error: null,
    last_result: null,
    policy: null,
    last_preview: null,
  };
}

/**
 * Applies the policy to a source's items against the library. Reads only:
 * the caller writes the plan inside its transaction, or summarizes it.
 */
async function planImport(
  db: Kysely<Database>,
  source: ImportSource,
  items: ImportedItem[],
  policy: ImportPolicy,
  now: number,
): Promise<ImportPlan> {
  const wants = entryFilter(source, policy);
  const ledger = new Map(
    (
      await db
        .selectFrom("import_items")
        .select(["item_id", "status"])
        .where("source", "=", source)
        .execute()
    ).map((row) => [row.item_id, row.status]),
  );
  const plan: ImportPlan = {
    writes: new Map(),
    seen: new Map(),
    unchanged: 0,
    filtered: 0,
    tvIds: new Set(),
  };
  for (const item of items) {
    if (!wants(item)) {
      plan.filtered++;
      continue;
    }
    const id = `${item.mediaType}:${item.sourceId}`;
    const pending = plan.writes.get(id);
    const row = pending
      ? undefined
      : await db
          .selectFrom("library_items")
          .selectAll()
          .where("id", "=", id)
          .executeTakeFirst();
    const current = pending?.doc ?? (row ? libraryItemRowToDoc(row) : null);
    if (current?._deleted) {
      plan.unchanged++;
      continue;
    }
    if (current ? !policy.updateExisting : !policy.addNew) {
      plan.filtered++;
      continue;
    }
    const doc = mergeImportedItem(item, current, now, {
      // Edge-triggered: only a status change in the source moves the item,
      // so a status set by hand sticks until the source moves on.
      updateStatus: policy.updateStatuses && ledger.get(id) !== item.status,
    });
    plan.seen.set(id, item.status);
    if (item.mediaType === "tv") plan.tvIds.add(id);
    if (!doc) {
      plan.unchanged++;
      continue;
    }
    plan.writes.set(id, {
      doc,
      existed: pending ? pending.existed : !!current,
      item,
    });
  }
  return plan;
}

function previewGroups(
  plan: ImportPlan,
  existed: boolean,
): Partial<Record<ImportBucket, ImportPreviewGroup>> {
  const groups: Partial<Record<ImportBucket, ImportPreviewGroup>> = {};
  for (const write of plan.writes.values()) {
    if (write.existed !== existed) continue;
    const group = (groups[importBucket(write.item.status)] ??= {
      count: 0,
      samples: [],
    });
    group.count++;
    if (group.samples.length < PREVIEW_SAMPLES)
      group.samples.push(write.item.title ?? write.doc.id);
  }
  return groups;
}

export class ImportService {
  private busy = false;
  private stopping = false;
  private idleWaiters: Array<() => void> = [];
  private readonly loadSource: SourceLoader;

  constructor(
    private readonly database: Kysely<Database>,
    loadSource?: SourceLoader,
    private readonly tvProgress: TvProgressHook = defaultTvProgress,
  ) {
    this.loadSource =
      loadSource ??
      ((source, config, wants) =>
        fetchSource(
          source,
          config,
          {
            ...sourceDefaults,
            // A fresh matcher per run reloads links and the library index.
            books: new GoodreadsBookMatcher(database, "bookorbit"),
          },
          wants,
        ));
  }

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
    await this.database.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("import_connections")
        .where("source", "=", source)
        .execute();
      // Matches belong to one source server; a new connection starts fresh.
      await trx
        .deleteFrom("import_book_links")
        .where("source", "=", source)
        .execute();
      await trx
        .deleteFrom("import_items")
        .where("source", "=", source)
        .execute();
    });
  }

  listBookLinks(source: BookLinkSource): Promise<ImportBookLink[]> {
    return listBookLinks(this.database, source);
  }

  /** Takes effect on the next import run. */
  setBookLink(
    source: BookLinkSource,
    externalId: string,
    goodreadsId: number | null,
  ): Promise<ImportBookLink | null> {
    return setBookLink(this.database, source, externalId, goodreadsId);
  }

  resetBookLink(source: BookLinkSource, externalId: string): Promise<boolean> {
    return resetBookLink(this.database, source, externalId);
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

  /** The policy every source without its own follows. */
  async defaults(): Promise<ImportPolicy> {
    const row = await this.database
      .selectFrom("import_settings")
      .select("policy")
      .where("id", "=", DEFAULTS_ID)
      .executeTakeFirst();
    return readPolicy(row?.policy ?? null) ?? DEFAULT_IMPORT_POLICY;
  }

  async saveDefaults(input: unknown): Promise<ImportPolicy> {
    const policy = importPolicySchema.parse(input);
    const value = { id: DEFAULTS_ID, policy: JSON.stringify(policy) };
    await this.database.transaction().execute(async (trx) => {
      await trx
        .insertInto("import_settings")
        .values(value)
        .onConflict((oc) => oc.column("id").doUpdateSet(value))
        .execute();
      // Previews of sources following the defaults no longer apply.
      await trx
        .updateTable("import_connections")
        .set({ last_preview: null })
        .where("policy", "is", null)
        .execute();
    });
    return policy;
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
    if (current.running !== IDLE)
      throw new Error(
        "Wait for the current import to finish before changing this connection.",
      );
    const config = IMPORT_ADAPTERS[source].normalizeConfig(
      {
        account: parsed.account,
        baseUrl: parsed.baseUrl.replace(/\/+$/, ""),
        apiKey: parsed.apiKey ?? current.api_key,
        accessToken: parsed.accessToken ?? current.access_token,
      },
      {
        account: current.account,
        baseUrl: current.base_url,
        apiKey: current.api_key,
        accessToken: current.access_token,
      },
    );
    const row = {
      ...current,
      enabled: parsed.enabled ? 1 : 0,
      schedule: parsed.schedule,
      account: config.account,
      base_url: config.baseUrl,
      api_key: config.apiKey,
      access_token: config.accessToken,
      policy:
        parsed.policy === undefined
          ? current.policy
          : parsed.policy && JSON.stringify(parsed.policy),
      // An error or preview from the previous settings no longer describes
      // this connection.
      last_error: null,
      last_preview: null,
    };
    await this.database
      .insertInto("import_connections")
      .values(row)
      .onConflict((oc) => oc.column("source").doUpdateSet(row))
      .execute();
    return publicConnection(row);
  }

  /** Claims synchronously in SQLite; only one source job runs at a time. */
  run(source: ImportSource, slot?: number): Promise<ImportResult> {
    return this.job(source, IMPORTING, slot, async (data, policy) => {
      const result: ImportResult = {
        added: 0,
        updated: 0,
        skipped: data.skipped,
        filtered: data.filtered ?? 0,
        warnings: data.warnings.slice(0, 20),
      };
      const written: ReplicatedLibraryItem[] = [];
      let latestSeq = 0;
      let tvIds: string[] = [];
      // Fetching sources stays outside the write queue. Only the library
      // transaction and its checkpoint publication serialize with client pushes.
      await withCollectionWriteLock("library_items", async () => {
        // One transaction: malformed rows cannot leave a partially imported library.
        await this.database.transaction().execute(async (trx) => {
          const now = Date.now();
          const plan = await planImport(trx, source, data.items, policy, now);
          result.skipped += plan.unchanged;
          result.filtered = (result.filtered ?? 0) + plan.filtered;
          tvIds = [...plan.tvIds];
          for (const { doc, existed } of plan.writes.values()) {
            const seq = nextRev("library_items");
            const record = libraryItemDocToRow(doc, seq);
            await trx
              .insertInto("library_items")
              .values(record)
              .onConflict((oc) => oc.column("id").doUpdateSet(record))
              .execute();
            if (existed) result.updated++;
            else result.added++;
            written.push(doc);
            latestSeq = seq;
          }
          for (const [itemId, status] of plan.seen) {
            const seen = { source, item_id: itemId, status, seen_at: now };
            await trx
              .insertInto("import_items")
              .values(seen)
              .onConflict((oc) =>
                oc.columns(["source", "item_id"]).doUpdateSet({
                  status,
                  seen_at: now,
                }),
              )
              .execute();
          }
        });
        if (written.length)
          emitChange("library_items", {
            documents: written,
            checkpoint: { seq: latestSeq },
          });
      });
      // Imported episode history only says "watching"; finish shows whose
      // season is over now rather than at the next hourly pass. Best effort:
      // the import itself already succeeded.
      if (tvIds.length)
        await this.tvProgress(this.database, tvIds).catch((error: unknown) =>
          console.error(
            `[imports] ${source} TV progress check failed:`,
            error instanceof Error ? error.message : error,
          ),
        );
      return {
        value: result,
        // The library changed under any earlier preview.
        fields: { last_result: JSON.stringify(result), last_preview: null },
      };
    });
  }

  /** Runs the source and the policy without writing; stored as `lastPreview`. */
  preview(source: ImportSource): Promise<ImportPreview> {
    return this.job(source, PREVIEWING, undefined, async (data, policy) => {
      const plan = await planImport(
        this.database,
        source,
        data.items,
        policy,
        Date.now(),
      );
      const preview: ImportPreview = {
        at: Date.now(),
        added: previewGroups(plan, false),
        updated: previewGroups(plan, true),
        filtered: (data.filtered ?? 0) + plan.filtered,
        skipped: data.skipped + plan.unchanged,
        warnings: data.warnings.slice(0, 20),
      };
      return {
        value: preview,
        fields: { last_preview: JSON.stringify(preview) },
      };
    });
  }

  /**
   * Claims the source, loads it under its effective policy, and hands the
   * data to `work`, recording the outcome on the connection.
   */
  private async job<T>(
    source: ImportSource,
    state: JobState,
    slot: number | undefined,
    work: (
      data: SourceData,
      policy: ImportPolicy,
    ) => Promise<{ value: T; fields: Partial<ImportConnectionsTable> }>,
  ): Promise<T> {
    if (this.stopping) throw new Error("Server is shutting down.");
    if (this.busy) throw new Error("Another import is already running.");
    this.busy = true;
    let claimed = false;
    try {
      const claim = await this.database
        .updateTable("import_connections")
        .set({
          running: state,
          last_error: null,
          ...(state === IMPORTING ? { last_run_at: Date.now() } : {}),
          ...(slot === undefined ? {} : { last_slot: slot }),
        })
        .where("source", "=", source)
        .where("running", "=", IDLE)
        .executeTakeFirst();
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
      const policy = readPolicy(row.policy) ?? (await this.defaults());
      const data = await this.loadSource(
        source,
        {
          account: row.account,
          baseUrl: row.base_url,
          apiKey: row.api_key,
          accessToken: row.access_token,
        },
        entryFilter(source, policy),
      );
      const { value, fields } = await work(data, policy);
      await this.database
        .updateTable("import_connections")
        .set({
          ...fields,
          running: IDLE,
          last_error: null,
          ...(data.account ? { account: data.account.slice(0, 200) } : {}),
        })
        .where("source", "=", source)
        .execute();
      return value;
    } catch (error) {
      // Stored errors are deliberately terse; the log carries the detail
      // (source responses are logged in full by `sourceJson`).
      if (claimed) {
        console.error(
          `[imports] ${source} ${state === PREVIEWING ? "preview" : "import"} failed:`,
          error instanceof Error ? (error.stack ?? error.message) : error,
        );
        await this.database
          .updateTable("import_connections")
          .set({
            running: IDLE,
            last_error:
              error instanceof Error &&
              /^(Steam|Trakt|BookOrbit|Source|IGDB)/.test(error.message)
                ? error.message.slice(0, 500)
                : "Import failed. Check source connectivity and credentials, then try again.",
          })
          .where("source", "=", source)
          .execute();
      }
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
      .where("running", "=", IDLE)
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
        running: IDLE,
        last_error:
          "Import interrupted by a server restart. Run it again or wait for the next scheduled time.",
      })
      .where("running", "!=", IDLE)
      .execute();
  }
}
