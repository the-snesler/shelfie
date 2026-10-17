<p align="center">
<img width="512" alt="Artboard1" src="https://github.com/user-attachments/assets/b3b54a7e-7bbc-4df3-9526-d90952a6c614" />
</p>

Shelfie is a media tracker that focuses on the physicality of the media, be it books, movies, or games. It is designed to feel like a personal library for your collection, and to help you keep track of what you own, what you're enjoying, and what you've experienced. Shelfie tracks games (via IGDB), movies and TV shows (via TMDB), and books (via Goodreads).

<img width="1484" height="981" alt="Screenshot 2026-07-19 at 1 29 04 PM" src="https://github.com/user-attachments/assets/61cefb58-90e5-4952-8d0c-ea3fa5035eaa" />

## Getting Started

```sh
pnpm install
cp .env.example .env   # then fill in your IGDB/TMDB keys
pnpm dev                # client on :5173, server on :3001
```

Optionally, run `pnpm seed` (with the dev server already running) to
populate a demo library.

See [AGENTS.md](./AGENTS.md) for an architecture tour of the codebase.

Visitors can search and view catalog pages without logging in. Your library,
calendar, recommendations, settings, and sync remain private. Login attempts
and anonymous catalog requests are rate limited.

Settings includes private iCal subscriptions, Apprise release reminders, and
manual or scheduled imports from Trakt, BookOrbit, and Steam. See
[integrations and deployment settings](./docs/integrations.md) for configuration,
import behavior, and service requirements. Recommendations suggest the next
title from your own backlog using your ratings and cached metadata.

Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, and
`pnpm test` before submitting changes. `pnpm format` applies formatting.

A Docker deployment is also available: `docker compose up --build` builds
the single-container image from the root `Dockerfile`/`docker-compose.yml`;
CI publishes a prebuilt image to GHCR on every push to `main`.
