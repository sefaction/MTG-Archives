# Acquisition catalog reconciliation

Work in progress under #463 and PR #472, following the full recognition accuracy
goal. The provider/cache and runtime reconciliation are loaded in local Docker;
the three-scanner-photo browser acceptance passed. No production changes.

## Implemented foundation

- Extract bounded set/collector/language and title queries from OCR without
  consulting the installation's known sets. Keep orientations separate and retain
  collector suffixes and source-set prefixes.
- Use the existing Scryfall client for exact printing, exact/fuzzy name and ID
  lookup, followed by complete exact-name/language printing enumeration. Requests
  contain public card identifiers/text only, never photo bytes.
- Construct pagination locally and validate returned cards. Missing initial
  results, provider errors and incomplete enumeration remain distinct. A valid
  original card plus a failed printing search does not establish absence of a
  List/Mystery counterpart.
- Cache public lookup results in PostgreSQL. Concurrent callers share a leased
  query; expired leases can be reclaimed, and late responses cannot overwrite a
  newer lease. Positive results expire after24h, negatives after1h, errors after
  at least5min. Provider Retry-After is respected. Rate-limit and401/403 cooldowns
  cover other uncached queries as well; valid cached results remain available.
- Apply metadata through `cardWriteData`, preserving local Card IDs and newer
  metadata. If a cached result's referenced card has disappeared locally, fetch
  it again. Cache records contain no ownership, review decisions or photographs.

## Evidence

- 670 unit checks passed, including 14 focused provider/client cases. Exact-name
  searches accept validated matching card faces (such as Island // Island) while
  continuing to reject unrelated cards, repeated IDs and incomplete pagination.
- Production build/typecheck and targeted ESLint passed.
- Real disposable PostgreSQL migration and acquisition/import verification passed,
  including shared lookup, deleted-row repair, stable IDs, negative cache, shared
  cooldown and stale-lease fencing. Test fixture/container/volume cleanup passed.
- A live metadata-only query for LGN131/en returned Krosan Vorine's original
  printing and PLST/LGN-131 in two requests, with complete printing enumeration.
  This verifies the actual Scryfall path, not merely a mocked provider.
- A live NEO285/en lookup returned 772 Island printings over five search pages
  (six requests including the initial printing). This corrected a real local
  browser failure caused by treating a matching double-faced result as invalid.
- The local real-photo browser test passed in2.4m: three saved originals completed
  OCR and catalog reconciliation, expected printing retained, full-frame/footer
  diagnostics, desktop1366/phone320 layout, reload and zero Inventory changes.
  Fixture cleanup passed. Its jobs were prioritized ahead of existing upgrade
  work, so this is functional evidence, not backlog or throughput acceptance.

## Runtime integration

1. A metadata service has database access but no photo/model mounts. Keep the
   native recognition container on its existing internal-only network.
2. Consume completed immutable OCR jobs through a new reconciliation stage.
   Recover using the existing durable job leases; reuse saved OCR rather than
   rerunning it for a catalog-only change. Fence publication against photo
   generation, candidate revision, ownership/activity and human review.
3. Query unresolved identifiers/names, repair metadata, then resolve against a
   refreshed catalog snapshot without restarting workers. Reuse the in-process
   snapshot between unchanged lookups; refresh after imports and periodically.
4. Make reconciliation a prerequisite for automatic confirmation. Missing or
   failed counterpart checks cannot become a strong match. Preserve stamp
   uncertainty, including Mystery variants; the actual stamp detector remains
   required by the larger goal.
5. Show catalog checking, reconciled results, no provider match, unreadable input
   and provider unavailability distinctly. Retain suggestions/diagnostics and
   explicit human correction. Reattempt unresolved provider/catalog cases with
   durable backoff; avoid continually reprocessing reviewed photos.
6. Connect authorized manual review search to the same fallback/cache, with no
   network request inside a held user/session transaction.
7. Real database checks cover deliberately missing metadata, refreshed proposals,
   repeated-cache reuse without OCR, manual-search fallback, provider failure,
   unauthorized search and a human review during reconciliation. Inventory stays
   unchanged. Abortable provider backoff respects request cancellation.

Automatic bulk metadata maintenance and image/index refresh remain subsequent
work in the overall goal; this batch provides on-demand reconciliation and
periodic retry of unreviewed results. Default-card coverage is not universal
language coverage. The actual stamp detector and image/OCR union are not delivered
by this batch. The overall goal remains open until those requirements and full
catalog accuracy/resource/recovery checks are proven.
