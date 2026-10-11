# Invalid inventory regex validation (#717)

Local Scryfall arguments validate supported regular expressions while compiling
the entire query. An invalid pattern produces the existing query error and an
empty inventory constraint before candidate or metadata reads. This applies to
Inventory, Public inventory, filtered exports and shared bulk-action constraints.

The original matcher compiled a regex for each card and returned false on a
syntax error. Consequently `name:/[/` compiled successfully and matched no cards,
while `-name:/[/` compiled successfully and matched every card. AND/OR evaluation
could also hide an invalid pattern in a branch it did not evaluate. This was
reproduced on unchanged main `5e7adbf` with ordinary card metadata.

The compiler now visits every term, including negated and nested terms, and
compiles supported name/oracle/fulloracle/type/flavor patterns once. Invalid
expressions invalidate the complete query. Successful expressions remain
case-insensitive and reuse the query cache; aliases, quoted patterns, face
metadata and ordinary text matching keep their existing behavior. The error
identifies the supported field without copying the engine exception or pattern.
The existing tokenizer and regex syntax envelope are unchanged.

## Qualification

- The unchanged-source regression failed both invalid-query rejection and the
  no-candidate-read assertion. Its valid-pattern control passed after correcting
  the test's flavor metadata to use the existing raw Scryfall field. Both initial
  and corrected-fixture baseline logs are retained privately.
- All eight focused cases pass after the fix, covering supported fields/aliases,
  bare names, quoted invalid patterns, negation, nested and short-circuited
  branches, valid patterns/face metadata, repeated matching, ordinary text and
  an empty owner-preserving constraint with no database reads.
- Owner-context core verification passes typecheck, all 880 tests, production
  build and all client manifest checks. Earlier sandbox-account core attempts
  failed only the Git ownership boundary in native checkout tests; they are
  retained separately and are not counted as passing verification.
- Final six query cases pass in 57.6 seconds: private/public desktop 1366px and
  phone 320px errors and empty results, both list APIs, GET/POST CSV rejection,
  valid regex/text list parity, and both existing valid-query navigation cases.
  Two ordinary CSV export cases and four preserved #722 Public fallback cases
  also pass. These are 12 distinct cases across groups, not 12 passes in one run.
  All four desktop/phone error screenshots were inspected.
- Initial browser runs failed an ambiguous duplicate-alert selector and an
  incorrect assumption that Public empty results render pagination. The tests
  now identify the existing alert and Public empty-state/copy-count elements;
  all rejection/empty-result assertions remain. The original failed artifacts
  are retained separately.
- The unchanged private valid-query test also failed twice on its original
  10-second expectation with a visible loading skeleton after the URL changed.
  An isolated exact-prior-image comparison passed, and the final current-image
  case passed. Its cause remains unresolved; related evidence is recorded in
  [#721](https://github.com/sefaction/MTG-Archives/issues/721#issuecomment-6100967282).
  No existing deadline was relaxed or loading behavior changed by this fix.
- Required-installer Docker build passes with installer 0.4.3 and all client
  manifest checks. The cumulative source is `336ec4c`, main `5e7adbf` plus #722
  (`4b865eb`) and this application's fix (`7684d39`). Loaded web image:
  `sha256:618d252ccdf30c13d9ffdcfb9cd84f407fe147af2cd1e119dfe741d9e2213aac`.
  Its 597 inputs match digest
  `8a89e09f0d3a978f07cc0606fe74300481d61943eeb300f84e3fc7eb121a1776`.
  Only `lib/inventory-scryfall-query.ts` differs from the previously loaded
  application. A Git checkout line-ending change in the preserved Public layout
  was detected and corrected before loading; the initial candidate build was
  cancelled and retained separately. An initial Compose preflight needed the
  existing model mount settings, recovered read-only from running services.
- Local login returns HTTP 200 and web is healthy. Only web was recreated; the
  other 12 ordinary service images/lifetimes, all mounts/limits and seven original
  Inventory/acquisition/receipt/scanner table projections are conserved. Browser
  checks do not mutate inventory or scan data. Temporary baseline containers and
  the copied cumulative test file are removed. No fixture cleanup remains.

Current-head CI is authoritative in the resolving PR. Its draft status is cleared
only after local qualification and all three required checks pass.

The issue stays open with its in-progress claim while the resolving PR awaits
scheduled review and individual human merge approval. No production changes or
data migration are included. Private logs and browser artifacts are untracked.
