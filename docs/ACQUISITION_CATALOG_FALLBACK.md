# Acquisition catalog reconciliation

Work in progress under #463, following the full recognition accuracy goal. The
provider and shared-cache foundations below are implemented and tested; they are
**not yet connected to the running scan workflow**. No production changes.

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

-22 focused provider/client unit checks passed, including existing client cases.
-Typecheck and targeted ESLint passed.
-Real disposable PostgreSQL migration and acquisition/import verification passed,
  including shared lookup, deleted-row repair, stable IDs, negative cache, shared
  cooldown and stale-lease fencing. Test fixture/container/volume cleanup passed.
-A live metadata-only query for LGN131/en returned Krosan Vorine's original
  printing and PLST/LGN-131 in two requests, with complete printing enumeration.
  This verifies the actual Scryfall path, not merely a mocked provider.

## Remaining integration in this batch

1. Add a metadata service with database access but no photo/model mounts. Keep the
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
7. Add automatic bulk metadata maintenance and image/index refresh; default-card
   coverage is not universal language coverage. Validate the complete integration
   in local Docker, including deliberately omitted metadata and saved reviews.

No worker, UI or automatic-confirmation behavior has been changed by the current
foundation. The overall goal remains open until integration and the other image/
printing verification requirements are proven.
