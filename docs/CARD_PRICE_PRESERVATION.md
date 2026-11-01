# Preserve independent prices during a Scryfall card refresh

Issue #861 was reproduced while planning #854 app-price recovery: the cached-card upsert replaced the entire `Card.prices` value with Scryfall's flat prices, removing the Pricing worker's `mtgjson` subtree. A missing price payload also replaced cached prices with an empty object. This affects normal cache/import/metadata refresh paths that call `upsertScryfallCard`; it is not evidence that this caused every historical missing projection or the WAL write failure.

The fix updates metadata and Scryfall prices in one transaction. The metadata upsert leaves an existing row's prices alone, then an atomic PostgreSQL expression combines the new Scryfall object with that row's committed MTGJSON subtree. The row lock remains held through commit. A Pricing write that committed after the initial metadata read is preserved; a later Pricing update preserves the refreshed Scryfall fields. The returned Card includes the committed combined prices.

Omitted or null Scryfall prices preserve cached prices and price-fetch time. An explicit empty object clears only Scryfall fields. Caller-supplied `mtgjson` is ignored rather than allowed to replace the Pricing writer's value or invent a projection for a new card. Card identity, MTGJSON mapping and first-cache time remain stable. Other metadata refresh behavior is unchanged; no schema, provider request, job retry or historical data repair is added.

## Verification

Acquisition bulk catalogue refreshes and provider-cache publication now use the
same atomic price writer. Bulk updates merge prices only after their conditional
metadata update succeeds; a skipped or superseded batch leaves prices alone.
Cache publication keeps the Card changes and lookup result in one transaction,
so a rejected price write cannot publish a successful lookup. Both paths retain
their existing fingerprint, newer-metadata, cursor and lease protections.

`scripts/verify-acquisition-price-preservation.ts` adds real PostgreSQL coverage
for both acquisition paths to the acquisition integrity suite. It checks price
payload variants, untrusted projections, stable identities, skipped updates,
rollback and both Pricing writer orders using observed row-lock barriers.

`scripts/verify-card-price-preservation.ts` runs against an opted-in local/CI PostgreSQL database with the migrated application schema. It owns two randomly identified Card fixtures and deletes them afterward. The current old app source fails specifically because the MTGJSON subtree disappears. The fix covers normal refresh, missing/null/empty prices, stale caller input, creation, SQL-null prices, an explicit JSON-null subtree, returned committed data and identity preservation. Real row-lock barriers exercise both writer orders without guessing timing. An injected price-update rejection verifies that metadata, source fingerprint and timestamps roll back too. The required import-integrity CI job includes the verifier.

No actual shared Card or pricing history was modified by those isolated tests. Pinning the current public pricing feed advanced #854 preparation, but shared catch-up was deferred when this overwrite path was reproduced. That feed's complete downloaded entity is retained privately with its publisher metadata and hash; it is not claimed to be the original interrupted feed. #854 still owns actual source/summary/app reconciliation, old-job history and the unexplained WAL failure. #861 is this narrowly scoped prevention fix.

Exact commits, local build/image/source checks, cumulative inclusion, CI and retained failed harness attempts are recorded in the PR and worker checkpoint. Independent review, individual merge approval and production rollout remain separate.
