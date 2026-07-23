# syntax=docker/dockerfile:1

# Single image: builds shared → client (static assets) → server, and the final
# runtime is just the server, which serves the built client + API on one port.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# Puppeteer (Twitter feed source): skip the chromium download during install -
# the runtime stage installs the browser + its OS deps once, into this shared
# cache dir, which puppeteer.launch() reads at run time.
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_CACHE_DIR=/app/.puppeteer-cache
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN corepack enable
WORKDIR /app

# --- deps: install the full workspace (manifests only first, for layer caching) ---
FROM base AS deps
# Toolchain for better-sqlite3's native build (used if no prebuilt binary matches).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile

# --- build: compile everything (turbo handles shared → client → server order) ---
FROM deps AS build
COPY . .
RUN pnpm build

# --- deploy: produce a self-contained server (dist + prod node_modules) ---
FROM build AS deploy
# --legacy: the server bundles @aside/shared via tsup, so we don't need pnpm's
# injected-workspace-packages deploy (which pnpm v10+ otherwise requires).
RUN pnpm deploy --filter=@shelfie/server --prod --legacy /app/deploy

# --- runtime: the single shipped image ---
FROM base AS runtime
ENV NODE_ENV=production
ENV STATIC_DIR=./public
ENV DATA_DIR=/data
ENV PORT=3001
WORKDIR /app
COPY --from=deploy /app/deploy/dist ./dist
COPY --from=deploy /app/deploy/node_modules ./node_modules
COPY --from=deploy /app/deploy/package.json ./package.json
COPY --from=build /app/packages/client/dist/client ./public
EXPOSE 3001
VOLUME /data
CMD ["node", "dist/index.js"]
