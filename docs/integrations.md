# Integrations and public browsing

All integration settings require the owner session and are stored only on the
server. They do not enter RxDB replication or CSV library exports. Back up the
SQLite database to preserve connections, calendar token hashes, and delivery
history. Stored source credentials and Apprise destinations are hidden in API
reads and the Settings page; they are plaintext in SQLite, so protect backups.

## Browser access and deployment

Search, card lookups, and media detail pages are public. Library documents,
TV schedules for your collection, sync, recommendations, and settings require
login. Guests see a sign-in prompt when saving a title. Logging out hides the
local library and stops replication; its data stays on the device for offline
use after signing in again.

Login, setup, and credential-change attempts are limited to five per minute
per client address. Anonymous catalog reads share a ten-unit quota per minute:
search and detail cost one, and card batches cost one per distinct identifier
(maximum ten). A 429 response includes `Retry-After`. These in-memory quotas
reset on server restart and are designed for Shelfie's single-process model.

CORS defaults to the request's own origin. If you host the browser frontend
separately, set `CORS_ORIGIN` to its exact origin, for example
`https://shelfie.example.com`, without a trailing slash or path. Wildcards are
rejected. The normal Vite proxy and single-container deployment need no override.

Rate limits use the socket address by default. Behind a reverse proxy, set
`TRUST_PROXY=1` only when the proxy overwrites `X-Forwarded-For` and the server
cannot be reached directly by untrusted clients. Shelfie uses the final address
in that header. Otherwise clients behind the proxy share the same quota.

## Calendar subscriptions

In Settings, create a calendar subscription and copy its private URL into your
calendar application's “subscribe by URL” control. The feed includes release
dates, TV episode air dates, and completion history from your collection.
Events are all-day entries. Stable identifiers allow clients to update moved
release dates. Dropped items retain completion history but omit future releases.

The URL contains a secret independent of your login session. It is shown only
when created; the server stores its hash. Anyone with the URL can read the feed.
Generate a replacement or revoke it in Settings to invalidate the previous URL.
Calendar applications choose their own refresh interval.

The feed and release reminders use cached metadata and never call catalog APIs.
Opening Shelfie refreshes owned cards; viewing a TV show refreshes its season
catalog. Dates unknown to the cache cannot appear until that metadata is fetched.

## Apprise reminders

Run an [Apprise API server](https://appriseit.com/api/) reachable from Shelfie's
container. In Settings, enter its base URL (for example `http://apprise:8000`)
and destination URLs, one per line. Save and enable reminders, choosing zero
to thirty days before release. “Send test to saved destinations” explicitly
sends a test. Saving alone does not send a test.

Shelfie uses the stateless `POST /notify/` API. This first version supports API
instances reachable without HTTP authentication. Destinations support the
services configured in your Apprise installation. Blank destinations preserve
saved ones; entering replacements replaces the full list. Disable reminders
to stop delivery.

The worker checks once per minute using UTC days, sends up to five reminders
per pass, and persists deduplication and exponential retries (five attempts).
Unsent reminders are cancelled when an item is removed, its release date moves,
or the lead-time setting changes. Retries are retained within a three-day
lookback. A stopped server misses newly due reminders; it does not backfill
every release that passed during downtime. Keep Shelfie running for reminders.

## Import sources

Expand a source under Settings → Import sources, save its connection, and use
“Import now”. Jobs run on the server, so closing the browser does not cancel
them. Only one import runs at a time. Last run counts, warnings, and errors
appear in Settings. Disconnect removes saved credentials and the schedule,
keeping imported library items.

Imports are additive and repeatable. New items use source statuses and progress;
existing items retain their status, notes, platforms, and nonempty rating.
Completion dates and episode watches are merged, missing progress is filled
when its unit matches, and Steam hours may increase. Soft-deleted items stay
deleted. Imports never delete items missing from a source. Malformed mapped
documents roll back the library transaction. Server writes use the normal
library sequence cursor and notify connected clients through SSE.

Imports and client sync pushes serialize their collection writes so a pull
checkpoint cannot skip an edit that is still waiting to commit. Source HTTP
requests happen before that write queue. Card metadata warms in batches of
one hundred IDs per medium, so a large imported library stays within upstream
request limits; failed batches leave existing offline cards intact.

To run periodically, enable “Run periodically” and enter a five-field cron
expression in UTC: minute, hour, day of month, month, weekday. Examples:

- `0 3 * * *`: daily at 03:00 UTC.
- `0 */6 * * *`: every six hours.
- `30 8 * * 1-5`: weekdays at 08:30 UTC.

Numeric lists, ranges, and steps are supported; Sunday is 0 or 7. When both
day fields are restricted, either may match. Names and nonstandard cron macros
are unsupported. The worker checks every thirty seconds, claims each scheduled
minute once, and resets interrupted jobs on restart. It does not backfill
missed schedule times. Imports are bounded to 10,000 rows per source collection
and ten megabytes per HTTP response; oversized sources fail rather than silently
truncating their library. Existing metadata is warmed by the normal client flow
after sync.

### Trakt

Enter your profile slug and a Trakt API application's client ID. Public profiles
need no access token; private profiles need a valid bearer access token. This
version accepts an existing token and does not perform OAuth or automatic token
refresh. Replace expired tokens in Settings.

Movies and shows map through TMDB IDs. The adapter reads paginated watchlist,
ratings, and history, maps movie watch dates to completion dates, and records
episode watch dates on TV items. Episode and season ratings are skipped because
Shelfie stores one show rating. Unsupported entries or missing TMDB IDs are
reported as skipped. Partial show history imports as active; no full-series
completion is inferred.

### BookOrbit

Enter the BookOrbit server's root URL and bearer access token. The adapter uses
its current `/api/v1/books/query` pagination and book detail endpoints. It reads
reading status, personal rating, progress, and finish dates. Each book needs a
Goodreads provider ID in BookOrbit: BookOrbit's local numeric ID is never used
as a Goodreads ID. Missing mappings are skipped and counted. Replace an expired
access token manually.

### Steam

Enter a SteamID64 (seventeen digits) and a Steam Web API key. The profile and
game details must be public. IGDB credentials must also be configured in the
Shelfie server environment.

Owned games map by exact Steam app ID through IGDB's `external_games` endpoint.
There is no fuzzy title match. Unmatched apps, including some tools and DLC,
are skipped and counted. Never-played games import as backlogged; recent play
imports as active; older play imports as paused. Playtime converts from minutes
to hours. Playtime never implies a completed game.

### Implementation references

The source adapters were checked against
[Yamtrack's Trakt adapter](https://github.com/FuzzyGrim/Yamtrack/blob/dev/src/integrations/imports/trakt.py),
[its Steam adapter](https://github.com/FuzzyGrim/Yamtrack/blob/dev/src/integrations/imports/steam.py),
and [BookOrbit's API controller](https://github.com/bookorbit/bookorbit/blob/main/server/src/modules/book/book.controller.ts).
The tests use controlled fixtures; live account imports require your own service
credentials and were not exercised during this implementation.

## Recommendations

Recommendations picks from your queued and paused titles using local card
metadata. Ratings of four stars or higher contribute genre, author, director,
and developer preferences. Each match identifies the title behind its reason.
Future releases are excluded, and titles with no preference evidence receive
simple backlog/resume suggestions. Media filters and Start/Resume actions work
offline. It does not discover titles outside your collection or contact an AI
service. Metadata warming is limited to twenty-four card lookups per refresh.
