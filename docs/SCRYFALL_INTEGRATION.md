# Scryfall Integration Notes

## Audit findings

- The previous Scryfall client used raw `fetch` calls against hardcoded `https://api.scryfall.com` URLs without an application `User-Agent`, `Accept` header, timeout, retry policy, or shared throttling.
- Automatic import matching treated every unresolved CSV row independently, so repeated copies of the same card could trigger repeated external lookups instead of reusing the local catalog or an in-request match cache.
- Name-only rows were fuzzy-matched and accepted automatically, which could silently choose a printing that the user did not identify in the CSV.
- Manual resolution searched Scryfall and then fetched the selected Scryfall ID again; failures were collapsed into a generic “could not be found” error and locally cached results were not consistently reused.
- The `Card` table stored only a subset of Scryfall metadata, which made the local database less useful as a durable printing catalog.

## Current architecture

- All live Scryfall calls go through `lib/scryfall.ts`, a server-side client with shared configuration, headers, timeout handling, retry handling, and in-process request spacing.
- Import, manual-resolution, inventory-correction, and API search paths use local card records first and only contact Scryfall for cache misses or explicit broader searches.
- Scryfall cards are persisted through `upsertScryfallCard`, which stores normalized searchable fields plus the raw Scryfall JSON and a stable fingerprint.
- Inventory browsing, trade display, exports, and dashboards read card details from PostgreSQL and do not call Scryfall during normal rendering.

## Request policy

- Default base URL: `https://api.scryfall.com`.
- Default user agent: `MTG-Archives/1.0`.
- Default request interval: 100 ms between outbound requests per web process.
- Retryable statuses: `429`, `500`, `502`, `503`, and `504`.
- Permanent statuses such as `400` and `404` are returned as structured errors and are not retried aggressively.
- `Retry-After` is honored when Scryfall supplies it; otherwise the client uses exponential backoff with jitter.

The throttle is in-process. The default Compose deployment runs one web container, so the default request rate remains conservative. If multiple web replicas are introduced later, each process will maintain its own throttle and a distributed limiter should be considered.

## Cache-first matching sequence

1. Scryfall ID in the import row.
2. Set code plus collector number, preserving collector number as a string.
3. Exact card name plus set code.
4. Exact card name in the local catalog.
5. Scryfall exact-name lookup only to confirm existence; name-only rows still require manual printing selection when the CSV does not identify a printing.
6. Manual search for fuzzy or broader candidates.

## Bulk data status

Persistent Scryfall bulk-data storage is now configured with `SCRYFALL_DATA_PATH` on the host and `SCRYFALL_CONTAINER_DATA_PATH` in the web container. Full streaming bulk import is intentionally deferred; it should be implemented as an explicit admin maintenance job rather than running during web startup.

## Import resolution jobs

The old “Deep resolve unresolved rows” action exposed the internal chunk size to users: it selected up to 50 rows, processed that one slice, and then stopped. The replacement workflow stores an `ImportResolutionJob` in PostgreSQL, starts or resumes one active job per import batch, and processes chunks internally until no automatically eligible rows remain.

Job statuses are `QUEUED`, `RUNNING`, `COMPLETED`, `COMPLETED_WITH_REVIEW`, `FAILED`, `CANCELLED`, and `STALE`. Each job records row totals, processed/resolved counts, cache hits, Scryfall matches, manual-review rows, not-found rows, transient/failed rows, Scryfall request counts, chunk number, heartbeat, completion time, and an error summary.

Automatic eligibility is intentionally conservative. Rows are skipped by the crawler when they are already linked to a card, already committed/skipped, ambiguous and requiring printing selection, missing deterministic data, or permanently classified as not found. The import commit step remains separate: resolution only links import rows to cached card printings and updates row status.

The server loop uses `IMPORT_RESOLVE_BATCH_SIZE` for each internal chunk and `IMPORT_RESOLVE_MAX_BATCHES_PER_RUN=0` to continue until exhaustion. If a nonzero max is configured, the job stops as `STALE` with a resumable message after that many chunks. The progress endpoint marks old `RUNNING` jobs stale using `IMPORT_RESOLVE_STALE_JOB_TIMEOUT_MINUTES` so an interrupted container can resume remaining rows safely.
