# Repository Guidelines

## Project Overview

Shelfie is a media tracker focused on the _physicality_ of a collection —
what you own, what you're playing/watching/reading, what you've finished —
rather than a generic watchlist. It tracks **games (IGDB), movies + TV
shows (TMDB), and books (Goodreads via its internal endpoints,
Grimmory-style)**. Local-first: the client writes to an in-browser RxDB
database that syncs to a thin server, which persists to SQLite, so the
library works offline and stays consistent across devices. Single-user,
single-container, self-hostable.

## Architecture & Data Flow

pnpm workspaces + Turbo, three packages, mirroring the shared-contract /
generic-sync pattern used by the sibling project `aside`:

```
packages/
├── shared/  @shelfie/shared   the client↔server contract (tsup: esm+cjs+dts)
│   └── src/
│       ├── types.ts        LibraryItem / Checkpoint / ItemStatus / MediaType / LOG_FORMATS / episodeKey()
│       ├── schema.ts       RxDB JSON schema (libraryItemSchema, v4) + migration strategies — the *only* synced schema
│       ├── validation.ts   zod libraryItemDocSchema — server push-boundary guard
│       ├── conflict.ts     createLwwConflictHandler<TDoc>() + libraryItemConflictHandler
│       ├── metadata.ts     game DTOs: SearchResult / GameMetadata (card) / GameDetail (detail) + GameVideo/StoreLink/TimeToBeat — HTTP-only, never synced
│       ├── movies.ts / tv.ts / books.ts   the same card/detail DTO split per medium (Movie*/Tv*/Book*), incl. TvSeason/TvEpisode (the episode catalog) — HTTP-only, never synced
│       ├── contract.test.ts    asserts zod ↔ RxDB schema field alignment stays in lockstep
│       └── index.ts        barrel export
├── client/  @shelfie/client  Vite + React 18 + RxDB (Dexie storage) + Tailwind v4
│   └── src/
│       ├── db/
│       │   ├── database.ts     singleton RxDatabase 'shelfiedb'; collections: library_items (synced) + game_metadata/movie_metadata/tv_metadata/book_metadata (local-only card caches)
│       │   ├── collections.ts  library_items (schema+migrationStrategies+conflictHandler) + the four card caches (schema only — never replicated, so no conflictHandler)
│       │   ├── gameCards.ts / movieCards.ts / tvCards.ts / bookCards.ts   per-medium card-cache docs + upsert helpers
│       │   └── replication.ts  startReplication() → /api/sync/<name>/{pull,push,stream}; called only for library_items — card caches are deliberately never passed in
│       ├── features/
│       │   ├── library/Library.tsx   grid of owned items across all media, reads card metadata reactively from the four local caches (renders offline), refreshed over HTTP on mount
│       │   ├── search/Search.tsx     tabbed search (Games/Movies/TV/Books) against the per-medium /api/*/search endpoints
│       │   ├── detail/Detail.tsx | MovieDetail.tsx | TvDetail.tsx | BookDetail.tsx   per-medium detail screens + status/progress editor; each warms its card cache on load. TvDetail owns the episode watched-checklist.
│       │   ├── media/          the shared item-editing layer: per-media status labels/subsets (status.ts), LogTarget + newLibraryItem (libraryActions.ts), StatusControl/LogPopover/LogModal/useLogPopover, MediaCover
│       │   └── games/          game-only visuals: GameCover physical-case rendering + platform templates
│       ├── routes.ts       react-router v7 (framework mode) route config: / , /search, /games/:slug, /movies/:id, /tv/:id, /books/:id, catch-all
│       ├── images.ts       gameImageUrl() (IGDB proxy) + tmdbImageUrl() (direct TMDB CDN); book covers are full URLs loaded directly
│       ├── auth.ts         bearer-token session auth (localStorage), authFetch() wrapper
│       ├── App.tsx, main.tsx, AuthScreen.tsx, index.css (Tailwind v4 theme tokens)
└── server/  @shelfie/server  Hono on @hono/node-server
    └── src/
        ├── index.ts   loads .env, initDb(), createApp(), serve()
        ├── app.ts     route wiring: cors → /health → auth routes → images → auth gate → sync routes (library_items only) → games/movies/tv/books routes → static (prod)
        ├── sync/
        │   ├── collection.ts   SyncCollection<TDoc> + equalDocs() conflict check — the generic pull/push/stream seam
        │   ├── library-items.ts  the one synced collection today (name 'library_items')
        │   ├── row.ts   camelCase ↔ snake_case doc/row mapping for library_items
        │   ├── pull.ts / push.ts / stream.ts   generic checkpointed pull, conflict-checked push, EventEmitter-backed SSE
        ├── db/
        │   ├── index.ts       Kysely singleton; dialect switch (SQLite live, Postgres throws "not implemented")
        │   ├── migrations.ts  numbered Migration[] with a `migrations` bookkeeping table (append-only, never edit shipped ones)
        │   ├── sequence.ts    in-memory per-table monotonic seq counters, primed from MAX(seq) on boot
        │   └── types.ts       Kysely Database interface (snake_case tables); per-medium *MetadataTable carries both card and detail columns, detail columns NULL until first detail fetch
        ├── auth/index.ts   single-user scrypt password + sha256-hashed bearer session tokens
        ├── igdb/           IGDB v4 API client (Twitch OAuth2, self-throttle, 401-retry-once); CARD_FIELDS/DETAIL_FIELDS query splitting, best-effort time-to-beat
        ├── tmdb/           TMDB v3 client (static Bearer TMDB_TOKEN, ~100ms self-throttle, 429-retry-once); movie/tv search + card/detail fetches, per-season episode fetches
        ├── goodreads/      Goodreads client (autocomplete search JSON + internal AppSync GraphQL getBookPageData; ~1s+jitter throttle; GOODREADS_APPSYNC_KEY env override)
        └── games/ movies/ tv/ books/   cache-first metadata endpoints per medium — search / batch-by-ids card / detail (by-slug for games, by-id elsewhere); row↔DTO mappers and upserts live directly in each routes.ts
```

**`shared` is load-bearing.** `LibraryItem`'s shape, its RxDB schema, its zod
validator, and its conflict handler all live in `packages/shared/src` and are
imported by both client and server. If they drift, sync corrupts silently —
`contract.test.ts` is the guardrail that keeps zod and the RxDB schema
aligned.

### Sync protocol

Standard RxDB replication, one collection today:

- `library_items` (read-write, id `${mediaType}:${sourceId}`, e.g. `game:1942`,
  `movie:438631`, `tv:1396`, `book:54493401`) — goes through the full
  pull/push/stream trio below. Metadata (card and detail tiers, all media) is
  deliberately **not** part of this protocol — see below.

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

### Metadata: card/detail tiers and the offline card caches

Catalog metadata is HTTP-only — it never goes through RxDB replication,
because it's a deterministic, server-owned cache of upstream data (IGDB,
TMDB, Goodreads) the client never writes to (nothing to conflict-resolve).
Two tiers per medium, DTOs in `shared/src/{metadata,movies,tv,books}.ts`,
each backed by its own server-side SQLite table (`game_metadata`,
`movie_metadata`, `tv_metadata`, `book_metadata`):

- **Card** (`GameMetadata`/`MovieMetadata`/`TvMetadata`/`BookMetadata`) — the
  small fields the library grid needs. Served batched via
  `GET /api/<medium>?ids=`; search via `GET /api/<medium>/search?q=`.
- **Detail** (`*Detail extends *Metadata`) — the heavy fields the detail page
  needs (screenshots/videos/cast/seasons+episodes/description…). Served on
  demand via `GET /api/games/by-slug/:slug` (games keep IGDB slugs) or
  `GET /api/{movies,tv,books}/by-id/:id` (TMDB has no slugs; Goodreads uses
  its legacy numeric book id).

Server-side, each `<medium>/routes.ts` treats a cached row as stale after
`METADATA_TTL_MS` (7 days). Card and detail freshness are tracked
independently (`fetched_at` vs. `detail_fetched_at`), so a card-only row
backfills its detail columns in place on first detail view. TV detail is the
expensive one: show + aggregate_credits/videos appends + `content_ratings` +
one `/tv/{id}/season/{n}` call per season (specials = season 0), all cached
into `tv_metadata.seasons` as the episode catalog.

Client-side, only the **card** projection is persisted, into local-only
(never-replicated) RxDB collections (`client/src/db/*Cards.ts`):
`Library.tsx` subscribes to all four so the grid renders offline, and
refetches `/api/<medium>?ids=` per media type present on mount to keep them
warm. The **detail** tier is never persisted client-side — detail screens
always fetch fresh and call the card upsert on success (each `*Detail`
structurally contains every card field).

Images: IGDB covers go through the server proxy (`/api/images/...`,
`images.ts` `gameImageUrl()`); TMDB posters/backdrops/stills load directly
from `image.tmdb.org` via `tmdbImageUrl(path, size)`; Goodreads covers are
full gr-assets URLs loaded directly.

### Domain model

`LibraryItem`: `id` (`${mediaType}:${sourceId}`), `mediaType` (`game | movie
| tv | book`), `sourceId` (IGDB / TMDB / Goodreads-legacy numeric id,
stringified), `status`, `progressFormat`/`progressValue`, `platforms`
(games only, else `[]`), `rating` (half-stars 0.5–5), `completedDates`,
`notes`, `watchedEpisodes`, `addedAt`/`updatedAt` (ms epoch).

- **Statuses are media-neutral canonical terms**: `wishlisted | backlogged |
active | paused | dropped | finished | completed`. Per-media display
  wording and which subset a media type exposes live client-side in
  `features/media/status.ts` (`STATUS_LABELS`, `STATUSES_BY_MEDIA`) — e.g.
  `active` renders as Playing/Watching/Reading, `finished` as
  Beaten/Watched/Read; only games expose `completed` (100%). `status` is
  deliberately a plain string in the RxDB schema (enum lives only in zod) so
  adding a status never forces a schema version bump.
- **Progress logs** (`progressFormat`/`progressValue`): allowed formats per
  medium via `LOG_FORMATS_BY_MEDIA` — games `hours|percent`, books
  `pages|percent|hours`, movies **none** (binary watched/unwatched), TV
  **none** (derived). An empty format list means the UI shows no manual
  progress editor.
- **TV progress is derived state**: `watchedEpisodes` holds episode keys
  (`episodeKey(season, episode)` → `"s1e3"`); progress = watched non-special
  keys / `numberOfEpisodes` from TV metadata (season 0 = TMDB's Specials,
  toggleable but excluded from the ratio). It lives on the synced
  `LibraryItem` (whole-doc LWW — a deliberate simplicity tradeoff for a
  single-user app), while the episode _catalog_ lives in TV detail metadata.

## Key Directories

- `packages/shared/src` — canonical doc types, RxDB schema, zod validation, conflict handler. Touch this first when the `LibraryItem` shape changes.
- `packages/client/src/db` — RxDB setup (database, collections, replication, per-medium `*Cards.ts` local card caches). The caches have no server-sync counterpart by design.
- `packages/client/src/features/*` — one directory per screen (`library`, `search`, `detail`) plus `media/` (the shared status/log editing layer + per-media labels) and `games/` (game-only cover/platform visuals); each screen owns its own effects/local state, no shared feature-level state store.
- `packages/server/src/sync` — generic pull/push/stream machinery, keyed by a `SyncCollection<TDoc>` descriptor; today only `library_items` uses it.
- `packages/server/src/db` — Kysely + better-sqlite3, numbered migrations, seq counters.
- `packages/server/src/{igdb,tmdb,goodreads}` — external API clients (throttling, retries, card/detail field handling per source).
- `packages/server/src/{games,movies,tv,books}` — cache-first metadata endpoints per medium; row↔DTO mappers and upsert helpers live in each `routes.ts`.
- `packages/server/src/auth` — single-user password/session auth.
- `scripts/` — dev-only Node scripts (`seed.mjs`, `screenshot.mjs`) that drive a _running_ dev instance; not part of the build.

## Development Commands

Run from the repo root (pnpm workspaces + Turbo):

- `pnpm dev` — Turbo runs all three packages: `shared` (tsup watch), `server` (`tsx watch`, port `SERVER_PORT`/`PORT`, default 3001), `client` (Vite, port `CLIENT_PORT`, default 5173, proxies `/api` → `SERVER_PORT`). Set `SERVER_PORT`/`CLIENT_PORT`/`DATA_DIR` (and re-run `pnpm seed`) to spin up an independent, fully isolated dev stack — e.g. one per agent working in parallel; the client's IndexedDB is already origin-scoped, so distinct `CLIENT_PORT`s isolate browser state for free. These vars only reach the tasks because they're listed in `turbo.json`'s `globalPassThroughEnv` (Turbo 2 strict env mode strips everything undeclared) — add new env vars there or they'll silently vanish inside `pnpm dev`.
- `pnpm build` — builds `shared` → `client` → `server` in dependency order (Turbo `dependsOn: ["^build"]`).
- `pnpm typecheck` — `tsc --noEmit` across packages (also gated on `^build`, since client/server import the built `@shelfie/shared`).
- `pnpm test` — Vitest. Real tests live in `packages/shared` (contract/validation/conflict) and `packages/server` (`igdb/rank.test.ts`); everything else runs `vitest run --passWithNoTests`.
- `pnpm lint` — wired through Turbo but **no package defines a `lint` script**, so this currently no-ops. Don't rely on it to catch anything.
- `pnpm format` — Prettier (`**/*.{ts,tsx,json,md}`), no dedicated `.prettierrc` (uses Prettier defaults).
- `pnpm seed` (`scripts/seed.mjs`) — claims the owner password (`admin`, the dev convention) against a running server, resolves a mix of real games, movies, TV shows, and books through the server's own per-medium search routes (so seeded items get real cover art), then pushes them through `/api/sync/library_items/push` (the TV seed includes a few `watchedEpisodes`). Card metadata is _not_ pre-warmed by seeding — the client populates its local caches on first `Library.tsx` mount; the very first book/movie cards can take a couple of seconds to appear while the server fetches upstream. Idempotent: re-running skips ids already present. Needs the server up (`pnpm dev`) plus `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET` and `TMDB_TOKEN` set; targets `http://localhost:$SERVER_PORT` (default 3001) unless `SHELFIE_SERVER_URL` is set; `SHELFIE_PASSWORD` overrides the claimed/expected password.
- `pnpm screenshot [path]` (`scripts/screenshot.mjs`) — opens the client in headless Chromium (Playwright), logs in if needed, waits for the library grid (or empty state) to settle, and saves a PNG (default `scripts/screenshot.png`). Needs the client up too; targets `http://localhost:$CLIENT_PORT` (default 5173) unless `SHELFIE_CLIENT_URL` is set; `SHELFIE_PASSWORD` overrides the expected password.

Typical flow for a task that needs to look at the UI: `pnpm dev` in the
background, then `pnpm seed`, then `pnpm screenshot [path]`.

Per-package equivalents also exist (`packages/<pkg>` + `pnpm dev|build|test|typecheck`); server also has `pnpm start` (`node dist/index.js`, runs the built output).

## Code Conventions & Common Patterns

- **Shared contract first.** Any change to a synced shape touches `packages/shared/src` (type, RxDB schema, zod validator if pushed, conflict handler, barrel export, `contract.test.ts`), then both client (`db/collections.ts`) and server (a `sync/*.ts` descriptor, a migration if columns change). Metadata DTOs (`shared/src/{metadata,movies,tv,books}.ts`) are lighter-weight — plain HTTP types, no zod validator, RxDB schema, or conflict handler needed since they're never client-written.
- **snake_case DB, camelCase TS.** Kysely table interfaces (`db/types.ts`) are snake_case; wire/doc types are camelCase. Mapping is centralized in small row↔doc functions (`sync/row.ts` for `library_items`; each medium's `routes.ts` mappers for metadata) rather than scattered inline.
- **Dependency injection via optional param.** Route registration functions take an optional `database` param defaulting to a module-level singleton (`registerAuthRoutes(app, database = defaultDb)`, `registerGamesRoutes(app, database = defaultDb)`) — enables passing a test DB instance without a DI framework.
- **Generic-over-collection sync.** `SyncCollection<TDoc>` (`sync/collection.ts`) is the seam for adding a new read-write synced collection: implement `parse`/`fetchSince`/`fetchById`/`upsert`, then one `registerSyncRoutes(app, coll)` call mounts `/api/sync/<name>/{pull,push,stream}`. Not every collection needs this — metadata caches are server-owned, deterministic, and never client-written, so they're plain HTTP + local-only client caches instead (see "Metadata" above).
- **Error handling.** Hono handlers return `c.json({ error: "..." }, status)` for expected 4xx cases rather than throwing; unexpected errors bubble to a 500. Server-internal helpers throw descriptive `Error`s (e.g. `"IGDB rate limit exceeded"`, `"Postgres is not implemented yet"`).
- **Async.** `async`/`await` throughout; no raw `.then()` chains except isolated cases (`Promise.withResolvers()` for the IGDB throttle queue and scrypt promisification).
- **Migrations are append-only.** `db/migrations.ts` is a numbered `Migration[]` array bookkept in a `migrations` table — add a new numbered entry, never edit a shipped one (contrast with RxDB's `migrationStrategies`, which is a separate, currently-empty seam in `shared/src/schema.ts`).
- **State management (client).** No global store, no React Query. RxDB is the reactive data layer (`collection.find().$` subscriptions via `useEffect`); everything else is local `useState`/`useEffect` per feature screen, with a `let active = true` unmount guard pattern on async effects.
- **Routing (client).** react-router v7 **framework mode** (`@react-router/dev`): file-route config in `src/routes.ts` (`index`/`route`/`layout` helpers), typegen via `react-router typegen` (wired into the `typecheck` script). Routes: `/`, `/search`, `/games/:slug`, `/movies/:id`, `/tv/:id`, `/books/:id`, catch-all → `/`.
- **Adding a media type.** Widen `MEDIA_TYPES` + zod, add per-media label/subset entries in `features/media/status.ts` and `LOG_FORMATS_BY_MEDIA`, add shared card/detail DTOs, a server client + `<medium>/routes.ts` + metadata table migration, a client `*Cards.ts` cache + collection, a detail screen + route, a Search tab, and Library href/caption/refresh branches. Statuses themselves need no schema bump.
- **Auth (client).** Never call bare `fetch` for `/api/*` — use `authFetch()` (`auth.ts`), which attaches the bearer token and treats a 401 (not 403) as session loss, dispatching a `shelfie-auth-lost` window event.
- **RxDB doc mutation.** Use `item.incrementalPatch({...})` for updates (see `Detail.tsx`), not manual field assignment — mirrors the "bump-then-remove" style needed for RxDB revisions to stay consistent with LWW conflict resolution.

## Important Files

- `packages/shared/src/types.ts` — canonical `LibraryItem` shape; change here ripples everywhere.
- `packages/shared/src/conflict.ts` — the LWW algorithm all sync correctness depends on.
- `packages/server/src/app.ts` — route wiring order (auth routes before the auth gate; static-file serving must stay last).
- `packages/server/src/db/migrations.ts` — schema history; append new migrations here.
- `packages/server/src/igdb/client.ts` — all outbound IGDB calls, rate limiting, retry-on-401; `CARD_FIELDS`/`DETAIL_FIELDS` query splitting and the `igdbFetch(url, body)` seam that lets a second endpoint (`game_time_to_beats`) share the same throttle/auth/retry plumbing.
- `packages/server/src/tmdb/client.ts` — all outbound TMDB calls (movies + TV, search/card/detail, per-season episode fetches, throttle + 429 handling).
- `packages/server/src/goodreads/client.ts` — Goodreads autocomplete search + AppSync GraphQL detail lookup, 1s+jitter politeness throttle, hard-fail on 401/403 (key rotated).
- `packages/server/src/{games,movies,tv,books}/routes.ts` — per-medium card/detail row↔DTO mappers, upserts, `METADATA_TTL_MS` staleness checks, and the `/api/<medium>` handlers.
- `packages/client/src/db/{gameCards,movieCards,tvCards,bookCards}.ts` — the local-only offline card caches: schema, card→doc projection, upsert helpers.
- `packages/client/src/features/media/status.ts` — per-media status labels (`STATUS_LABELS`), exposed subsets (`STATUSES_BY_MEDIA`), completion-date prompts.
- `packages/client/src/features/media/libraryActions.ts` — `LogTarget` + `newLibraryItem()`, the single choke point every add-to-library path goes through.
- `packages/client/src/db/replication.ts` — client-side RxDB replication wiring against the sync routes.
- `packages/client/src/auth.ts` — `authFetch()`, the required wrapper for all authenticated client requests.
- `.env` (root, gitignored) — `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` / `TMDB_TOKEN` (TMDB API Read Access Token, Bearer). Optional: `GOODREADS_APPSYNC_KEY` (overrides the built-in AppSync api key if Goodreads rotates it). Server also reads `SERVER_PORT` (falls back to `PORT`), `DATABASE_URL`, `DATA_DIR`, `STATIC_DIR`; client (`vite.config.ts`) reads `CLIENT_PORT` and `SERVER_PORT` for its own port and proxy target (all optional, sensible defaults). `.env.example` (root, committed) is the template — `cp .env.example .env` and fill in real values.
- `turbo.json` — task graph (`build`/`typecheck`/`lint` depend on `^build`; `test`/`dev` don't) + `globalPassThroughEnv` (the allowlist that lets `SERVER_PORT`/`DATA_DIR`/API keys reach tasks under Turbo 2 strict env mode).

## Runtime/Tooling Preferences

- **Node ≥ 22** (`engines.node` in root `package.json`); **pnpm 11.5.2** pinned via `packageManager`. Not a Bun project.
- pnpm workspaces (`pnpm-workspace.yaml`: `packages/*`) + Turbo 2.x for task orchestration — always run scripts through the root `pnpm <script>` (Turbo) rather than `cd`-ing into a package, unless iterating on one package only.
- Native/postinstall scripts are gated by pnpm; `better-sqlite3` and `esbuild` are pre-approved under `allowBuilds` in `pnpm-workspace.yaml`. If a native dep won't load, check it's approved there and `pnpm rebuild <pkg>`.
- No path aliases anywhere (`tsconfig.base.json` and every package tsconfig) — cross-package imports go through the `@shelfie/shared` workspace package name, never TS `paths`.
- TypeScript is strict everywhere (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` in `tsconfig.base.json`).
- No ESLint/Biome configured despite the `lint` script existing — don't assume lint is catching anything until one is added.
- CI (`.github/workflows/ci.yml`) gates every PR: a `checks` job runs `pnpm typecheck` → `pnpm build` → `pnpm test` across the workspace, then a `docker` job builds the Docker image (no push) on PRs and publishes it to GHCR (`ghcr.io/<repo>`) on pushes to `main` via `macbre/push-to-ghcr`. `Dockerfile` (root) is a multi-stage build — deps → build (Turbo `shared`→`client`→`server`) → `pnpm deploy` a prod-only server bundle → a slim runtime stage that serves the built client (`STATIC_DIR=./public`) and API from one container/port (`3001`), persisting SQLite to a `/data` volume. `docker-compose.yml` + `.dockerignore` also live at root; `aside`'s prod deployment patterns (single-container Docker build, `STATIC_DIR` static serving) are the ones this Dockerfile follows.

## Testing & QA

- **Framework:** Vitest, hoisted once as a root devDependency, invoked per-package as `vitest run`. No `vitest.config.*` anywhere — defaults pick up colocated `*.test.ts` files.
- **Coverage today:** `packages/shared` — `conflict.test.ts` (LWW resolution + equality), `validation.test.ts` (zod bounds/regex/enum checks incl. mediaType/watchedEpisodes), `contract.test.ts` (zod ↔ RxDB schema field alignment + migration strategies, the shared-contract guardrail); `packages/server` — `igdb/rank.test.ts`. `client` has zero test files; its `test` script passes trivially via `--passWithNoTests`. Don't treat that green as coverage.
- **Running tests:** `pnpm test` (all packages via Turbo) or `pnpm --filter @shelfie/shared test` for just shared.
- **Manual/visual verification:** for client-visible changes, prefer the `pnpm seed` + `pnpm screenshot` flow over writing new tests from scratch — it exercises the real auth + sync + IGDB path against a running dev instance and is the fastest way to confirm a UI change actually rendered.
- When adding tests for new shared-contract fields, follow the existing pattern: extend `validation.test.ts` for the zod boundary, `contract.test.ts` for schema/zod alignment, and `conflict.test.ts` if the field affects conflict resolution.
