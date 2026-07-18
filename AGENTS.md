# Repository Guidelines

## Project Overview

Shelfie is a media tracker focused on the *physicality* of a collection —
what you own, what you're playing, what you've finished — rather than a
generic watchlist. It's currently game-only (backed by IGDB metadata) but is
built to grow into books/movies/TV. Local-first: the client writes to an
in-browser RxDB database that syncs to a thin server, which persists to
SQLite, so the library works offline and stays consistent across devices.
Single-user, single-container, self-hostable.

## Architecture & Data Flow

pnpm workspaces + Turbo, three packages, mirroring the shared-contract /
generic-sync pattern used by the sibling project `aside`:

```
packages/
├── shared/  @shelfie/shared   the client↔server contract (tsup: esm+cjs+dts)
│   └── src/
│       ├── types.ts        LibraryItem / Checkpoint / ItemStatus
│       ├── schema.ts       RxDB JSON schema (libraryItemSchema) + migration seams — the *only* synced schema
│       ├── validation.ts   zod libraryItemDocSchema — server push-boundary guard
│       ├── conflict.ts     createLwwConflictHandler<TDoc>() + libraryItemConflictHandler
│       ├── metadata.ts     SearchResult / GameMetadata (card) / GameDetail (detail, extends GameMetadata) + GameVideo/StoreLink/StoreName/TimeToBeat — HTTP-only DTOs, never synced
│       ├── contract.test.ts    asserts zod ↔ RxDB schema field alignment stays in lockstep
│       └── index.ts        barrel export
├── client/  @shelfie/client  Vite + React 18 + RxDB (Dexie storage) + Tailwind v4
│   └── src/
│       ├── db/
│       │   ├── database.ts     singleton RxDatabase 'shelfiedb' (dev-mode + ajv validator); collections: library_items (synced) + game_metadata (local-only card cache)
│       │   ├── collections.ts  library_items (schema+migrationStrategies+conflictHandler) + game_metadata (schema only — never replicated, so no conflictHandler)
│       │   ├── gameCards.ts    GameCardDoc + gameCardSchema (local RxDB schema for the card tier) + cardToDoc/upsertCards — the offline card cache
│       │   └── replication.ts  startReplication() → /api/sync/<name>/{pull,push,stream}; called only for library_items — game_metadata is deliberately never passed in
│       ├── features/
│       │   ├── library/Library.tsx   grid of owned items, reads card metadata reactively from the local game_metadata collection (renders offline), refreshed over HTTP on mount
│       │   ├── search/Search.tsx     debounced IGDB search via /api/games/search
│       │   └── detail/Detail.tsx     rich per-game detail (ratings, screenshots, videos, stores, time-to-beat, modes/themes/perspectives) + status/progress editor; warms the card cache on load
│       ├── router.ts       hand-rolled History API router (no react-router)
│       ├── auth.ts         bearer-token session auth (localStorage), authFetch() wrapper
│       ├── App.tsx, main.tsx, AuthScreen.tsx, index.css (Tailwind v4 theme tokens)
└── server/  @shelfie/server  Hono on @hono/node-server
    └── src/
        ├── index.ts   loads .env, initDb(), createApp(), serve()
        ├── app.ts     route wiring: cors → /health → auth routes → auth gate → sync routes (library_items only) → games routes → static (prod)
        ├── sync/
        │   ├── collection.ts   SyncCollection<TDoc> + equalDocs() conflict check — the generic pull/push/stream seam
        │   ├── library-items.ts  the one synced collection today (name 'library_items')
        │   ├── row.ts   camelCase ↔ snake_case doc/row mapping for library_items
        │   ├── pull.ts / push.ts / stream.ts   generic checkpointed pull, conflict-checked push, EventEmitter-backed SSE
        ├── db/
        │   ├── index.ts       Kysely singleton; dialect switch (SQLite live, Postgres throws "not implemented")
        │   ├── migrations.ts  numbered Migration[] with a `migrations` bookkeeping table (append-only, never edit shipped ones)
        │   ├── sequence.ts    in-memory per-table monotonic seq counters, primed from MAX(seq) on boot
        │   └── types.ts       Kysely Database interface (snake_case tables); `GameMetadataTable` carries both card and detail columns, detail columns NULL until first detail fetch
        ├── auth/index.ts   single-user scrypt password + sha256-hashed bearer session tokens
        ├── igdb/           IGDB v4 API client (Twitch OAuth2, ~4req/s self-throttle, 401-retry-once); CARD_FIELDS/DETAIL_FIELDS query splitting, fetchGameDetailBySlug + best-effort fetchTimeToBeat (game_time_to_beats)
        └── games/          cache-first game metadata endpoints in front of IGDB — search / batch-by-ids card / by-slug detail; row↔DTO mappers (metadataRowToDto/metadataRowToDetail/etc.) and upsertMetadata/upsertDetail live directly in routes.ts
```

**`shared` is load-bearing.** `LibraryItem`'s shape, its RxDB schema, its zod
validator, and its conflict handler all live in `packages/shared/src` and are
imported by both client and server. If they drift, sync corrupts silently —
`contract.test.ts` is the guardrail that keeps zod and the RxDB schema
aligned.

### Sync protocol

Standard RxDB replication, one collection today:

- `library_items` (read-write, id `${mediaType}:${sourceId}`, e.g. `game:1942`) —
  goes through the full pull/push/stream trio below. Game metadata (card and
  detail tiers) is deliberately **not** part of this protocol — see below.

- **pull** — client POSTs `{checkpoint, batchSize}`; server returns rows
  since `checkpoint.seq` and a new checkpoint from the last row's `seq`
  (`sync/pull.ts`). The server owns the monotonic `seq` cursor
  (`db/sequence.ts`), not client clocks.
- **push** — client POSTs `PushRow<TDoc>[]` (`{newDocumentState,
  assumedMasterState}`); server validates with zod (`coll.parse`), diffs the
  real master against `assumedMasterState` via `equalDocs()`, and either
  upserts (assigning the next `seq`) or returns the real master as a
  conflict for the client to reconcile (`sync/push.ts`).
- **stream** — SSE (`hono/streaming` `streamSSE`) fed by an in-process
  `EventEmitter`, namespaced by collection name (`sync/stream.ts`); a
  successful push calls `emitChange()` so other tabs/devices update live.
  Single-container/single-process — no external broker.
- **Conflict resolution** — deterministic LWW (`shared/src/conflict.ts`):
  newer `updatedAt` wins → tie prefers the deleted doc → stable
  JSON-key-sorted comparison as a final tiebreak. Deletes are soft
  (`_deleted: true`) and still bump `updatedAt` so LWW sees them as a later
  write.

### Game metadata: card/detail tiers and the offline card cache

Game metadata is HTTP-only — it never goes through RxDB replication, because
it's a deterministic, server-owned cache of IGDB data the client never
writes to (nothing to conflict-resolve). Two tiers, both DTOs in
`shared/src/metadata.ts` and both backed by the same server-side
`game_metadata` SQLite table:

- **Card** (`GameMetadata`) — the small fields the library grid needs (name,
  cover, genres, platforms, developer, release dates). Served batched via
  `GET /api/games?ids=` and one-off via `GET /api/games/search`.
- **Detail** (`GameDetail extends GameMetadata`) — adds the heavy fields the
  detail page needs: storyline, screenshots, videos, game modes, themes,
  player perspectives, publisher, critic/user ratings, storefront links,
  time-to-beat. Served on demand via `GET /api/games/by-slug/:slug`.

Server-side, `games/routes.ts` treats a cached row as stale after
`METADATA_TTL_MS` (7 days) and refetches from IGDB — card rows via
`fetchGamesByIds`, detail rows via `fetchGameDetailBySlug` (which
separately best-effort-fetches time-to-beat and never fails the whole
request if that lookup errors). Card and detail freshness are tracked
independently (`fetched_at` vs. `detail_fetched_at`), so a card-only row
backfills its detail columns in place on first detail view without
disturbing rows that already have both.

Client-side, only the **card** projection is persisted, into a local-only
(never-replicated) RxDB collection `game_metadata`
(`client/src/db/gameCards.ts`): `Library.tsx` subscribes to it so the grid
renders covers/titles/status from IndexedDB even offline, and separately
refetches `/api/games?ids=` on mount to call `upsertCards()` and keep it
warm. The **detail** tier is never persisted client-side — `Detail.tsx`
always fetches it fresh (`upsertCards()` is called on a successful detail
load too, since `GameDetail` structurally contains every card field, just
to keep the grid's cache warm from detail-page visits).

### Domain model

`LibraryItem`: `id` (`${mediaType}:${sourceId}`), `mediaType` (currently only
`"game"`), `sourceId` (IGDB id), `status` (`wishlisted | backlogged | playing
| played | beaten | completed`), `progress` (0–100 int, or `null` — only
meaningful when `status === "playing"`), `addedAt`/`updatedAt` (ms epoch).
`status` is deliberately typed as a plain string in the RxDB schema (enum
validation lives only in zod) so adding a status never forces a schema
version bump.

## Key Directories

- `packages/shared/src` — canonical doc types, RxDB schema, zod validation, conflict handler. Touch this first when the `LibraryItem` shape changes.
- `packages/client/src/db` — RxDB setup (database, collections, replication, `gameCards.ts` local card cache). Mirrors `packages/server/src/sync` for `library_items`; `game_metadata` has no server-sync counterpart by design.
- `packages/client/src/features/*` — one directory per screen (`library`, `search`, `detail`); each owns its own effects/local state, no shared feature-level state store.
- `packages/server/src/sync` — generic pull/push/stream machinery, keyed by a `SyncCollection<TDoc>` descriptor; today only `library_items` uses it.
- `packages/server/src/db` — Kysely + better-sqlite3, numbered migrations, seq counters.
- `packages/server/src/igdb` — external IGDB API client (auth token cache, rate limiting, query building, card/detail field sets, time-to-beat lookup).
- `packages/server/src/games` — cache-first metadata endpoints in front of IGDB (search, batch-by-ids card, by-slug detail); row↔DTO mappers and upsert helpers live in `routes.ts`.
- `packages/server/src/auth` — single-user password/session auth.
- `scripts/` — dev-only Node scripts (`seed.mjs`, `screenshot.mjs`) that drive a *running* dev instance; not part of the build.

## Development Commands

Run from the repo root (pnpm workspaces + Turbo):

- `pnpm dev` — Turbo runs all three packages: `shared` (tsup watch), `server` (`tsx watch`, port 3001), `client` (Vite, port 5173, proxies `/api` → 3001).
- `pnpm build` — builds `shared` → `client` → `server` in dependency order (Turbo `dependsOn: ["^build"]`).
- `pnpm typecheck` — `tsc --noEmit` across packages (also gated on `^build`, since client/server import the built `@shelfie/shared`).
- `pnpm test` — Vitest. Only `packages/shared` has real tests today; `client`/`server` run `vitest run --passWithNoTests` (currently trivially pass — no test files yet).
- `pnpm lint` — wired through Turbo but **no package defines a `lint` script**, so this currently no-ops. Don't rely on it to catch anything.
- `pnpm format` — Prettier (`**/*.{ts,tsx,json,md}`), no dedicated `.prettierrc` (uses Prettier defaults).
- `pnpm seed` (`scripts/seed.mjs`) — claims the owner password (`admin`, the dev convention) against a running server, resolves a handful of real games through the server's own `/api/games/search` (so seeded items get real IGDB cover art), then pushes them through `/api/sync/library_items/push`. Card metadata is *not* pre-warmed by seeding — the client populates its local `game_metadata` cache itself on first `Library.tsx` mount via `GET /api/games?ids=`. Idempotent: re-running skips ids already present. Needs the server up (`pnpm dev`) and `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET` set; override target with `SHELFIE_SERVER_URL` / `SHELFIE_PASSWORD`.
- `pnpm screenshot [path]` (`scripts/screenshot.mjs`) — opens the client in headless Chromium (Playwright), logs in if needed, waits for the library grid (or empty state) to settle, and saves a PNG (default `scripts/screenshot.png`). Needs the client up too; override with `SHELFIE_CLIENT_URL` / `SHELFIE_PASSWORD`.

Typical flow for a task that needs to look at the UI: `pnpm dev` in the
background, then `pnpm seed`, then `pnpm screenshot [path]`.

Per-package equivalents also exist (`packages/<pkg>` + `pnpm dev|build|test|typecheck`); server also has `pnpm start` (`node dist/index.js`, runs the built output).

## Code Conventions & Common Patterns

- **Shared contract first.** Any change to a synced shape touches `packages/shared/src` (type, RxDB schema, zod validator if pushed, conflict handler, barrel export, `contract.test.ts`), then both client (`db/collections.ts`) and server (a `sync/*.ts` descriptor, a migration if columns change). Game metadata DTOs (`GameMetadata`/`GameDetail` in `shared/src/metadata.ts`) are lighter-weight — plain HTTP types, no zod validator, RxDB schema, or conflict handler needed since they're never client-written.
- **snake_case DB, camelCase TS.** Kysely table interfaces (`db/types.ts`) are snake_case; wire/doc types are camelCase. Mapping is centralized in small row↔doc functions (`sync/row.ts` for `library_items`; `games/routes.ts`'s `metadataRowToDto`/`metadataToRow`/`metadataRowToDetail`/`detailToRow` for game metadata) rather than scattered inline.
- **Dependency injection via optional param.** Route registration functions take an optional `database` param defaulting to a module-level singleton (`registerAuthRoutes(app, database = defaultDb)`, `registerGamesRoutes(app, database = defaultDb)`) — enables passing a test DB instance without a DI framework.
- **Generic-over-collection sync.** `SyncCollection<TDoc>` (`sync/collection.ts`) is the seam for adding a new read-write synced collection: implement `parse`/`fetchSince`/`fetchById`/`upsert`, then one `registerSyncRoutes(app, coll)` call mounts `/api/sync/<name>/{pull,push,stream}`. Not every collection needs this — `game_metadata` is server-owned, deterministic, and never client-written, so it's plain HTTP + a local-only client cache instead (see "Game metadata" above).
- **Error handling.** Hono handlers return `c.json({ error: "..." }, status)` for expected 4xx cases rather than throwing; unexpected errors bubble to a 500. Server-internal helpers throw descriptive `Error`s (e.g. `"IGDB rate limit exceeded"`, `"Postgres is not implemented yet"`).
- **Async.** `async`/`await` throughout; no raw `.then()` chains except isolated cases (`Promise.withResolvers()` for the IGDB throttle queue and scrypt promisification).
- **Migrations are append-only.** `db/migrations.ts` is a numbered `Migration[]` array bookkept in a `migrations` table — add a new numbered entry, never edit a shipped one (contrast with RxDB's `migrationStrategies`, which is a separate, currently-empty seam in `shared/src/schema.ts`).
- **State management (client).** No global store, no React Query. RxDB is the reactive data layer (`collection.find().$` subscriptions via `useEffect`); everything else is local `useState`/`useEffect` per feature screen, with a `let active = true` unmount guard pattern on async effects.
- **Routing (client).** Hand-rolled — `router.ts` uses `history.pushState`/`popstate` + a module-level pub/sub, not a router library. Exactly 3 routes exist (`/`, `/search`, `/games/:slug`); anything else redirects to `/`.
- **Auth (client).** Never call bare `fetch` for `/api/*` — use `authFetch()` (`auth.ts`), which attaches the bearer token and treats a 401 (not 403) as session loss, dispatching a `shelfie-auth-lost` window event.
- **RxDB doc mutation.** Use `item.incrementalPatch({...})` for updates (see `Detail.tsx`), not manual field assignment — mirrors the "bump-then-remove" style needed for RxDB revisions to stay consistent with LWW conflict resolution.

## Important Files

- `packages/shared/src/types.ts` — canonical `LibraryItem` shape; change here ripples everywhere.
- `packages/shared/src/conflict.ts` — the LWW algorithm all sync correctness depends on.
- `packages/server/src/app.ts` — route wiring order (auth routes before the auth gate; static-file serving must stay last).
- `packages/server/src/db/migrations.ts` — schema history; append new migrations here.
- `packages/server/src/igdb/client.ts` — all outbound IGDB calls, rate limiting, retry-on-401; `CARD_FIELDS`/`DETAIL_FIELDS` query splitting and the `igdbFetch(url, body)` seam that lets a second endpoint (`game_time_to_beats`) share the same throttle/auth/retry plumbing.
- `packages/server/src/games/routes.ts` — card/detail row↔DTO mappers, `upsertMetadata`/`upsertDetail`, `METADATA_TTL_MS` staleness checks, and the `/api/games`/`/api/games/by-slug/:slug` handlers.
- `packages/client/src/db/gameCards.ts` — the local-only offline card cache: schema, `cardToDoc` projection, `upsertCards`.
- `packages/client/src/db/replication.ts` — client-side RxDB replication wiring against the sync routes.
- `packages/client/src/auth.ts` — `authFetch()`, the required wrapper for all authenticated client requests.
- `.env` (root, gitignored) — `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET`. Server also reads `PORT`, `DATABASE_URL`, `DATA_DIR`, `STATIC_DIR` (all optional, sensible defaults in `db/index.ts`/`index.ts`).
- `turbo.json` — task graph (`build`/`typecheck`/`lint` depend on `^build`; `test`/`dev` don't).

## Runtime/Tooling Preferences

- **Node ≥ 22** (`engines.node` in root `package.json`); **pnpm 11.5.2** pinned via `packageManager`. Not a Bun project.
- pnpm workspaces (`pnpm-workspace.yaml`: `packages/*`) + Turbo 2.x for task orchestration — always run scripts through the root `pnpm <script>` (Turbo) rather than `cd`-ing into a package, unless iterating on one package only.
- Native/postinstall scripts are gated by pnpm; `better-sqlite3` and `esbuild` are pre-approved under `allowBuilds` in `pnpm-workspace.yaml`. If a native dep won't load, check it's approved there and `pnpm rebuild <pkg>`.
- No path aliases anywhere (`tsconfig.base.json` and every package tsconfig) — cross-package imports go through the `@shelfie/shared` workspace package name, never TS `paths`.
- TypeScript is strict everywhere (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` in `tsconfig.base.json`).
- No ESLint/Biome configured despite the `lint` script existing — don't assume lint is catching anything until one is added.
- No CI (`.github/workflows` absent), no Dockerfile — this repo is dev-only today; `aside`'s prod deployment patterns (single-container Docker build, `STATIC_DIR` static serving) are already partially wired server-side (`app.ts`) but not yet exercised by a Dockerfile here.

## Testing & QA

- **Framework:** Vitest, hoisted once as a root devDependency, invoked per-package as `vitest run`. No `vitest.config.*` anywhere — defaults pick up colocated `*.test.ts` files.
- **Coverage today:** only `packages/shared` has real tests — `conflict.test.ts` (LWW resolution + equality), `validation.test.ts` (zod bounds/regex/enum checks), `contract.test.ts` (zod ↔ RxDB schema field alignment, the shared-contract guardrail). `client` and `server` have zero test files; their `test` scripts pass trivially via `--passWithNoTests`. Don't treat that green as coverage.
- **Running tests:** `pnpm test` (all packages via Turbo) or `pnpm --filter @shelfie/shared test` for just shared.
- **Manual/visual verification:** for client-visible changes, prefer the `pnpm seed` + `pnpm screenshot` flow over writing new tests from scratch — it exercises the real auth + sync + IGDB path against a running dev instance and is the fastest way to confirm a UI change actually rendered.
- When adding tests for new shared-contract fields, follow the existing pattern: extend `validation.test.ts` for the zod boundary, `contract.test.ts` for schema/zod alignment, and `conflict.test.ts` if the field affects conflict resolution.
