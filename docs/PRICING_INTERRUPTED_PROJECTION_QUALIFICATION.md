# Interrupted app-price publication qualification

This test covers the application `Card.prices.mtgjson` stage that follows Pricing source ingestion and summary refresh. A successful rebuild of Pricing summaries does not update application Card prices or establish completion of an interrupted feed.

## Maintained regression

Run `MTG_LOCAL_PILOT_TEST=1 PRICING_DATABASE_URL=... npx tsx scripts/verify-pricing-interrupted-projection.ts` against a local/CI PostgreSQL service. It creates and removes two randomly named disposable databases. It rejects nonlocal hosts and connection-query endpoint overrides and clears inherited libpq endpoint/service settings. Its own loopback HTTP server supplies the entire synthetic feed; automatic scheduling and external providers are disabled. The required PostgreSQL import-integrity CI job runs this verifier.

The real worker imports 51 synthetic printings over two dates, then the real rebuild CLI establishes the ready baseline used by the affected installation. App price precision follows the original feed value rather than the rounded raw numeric column. A revision corrects an existing observation and adds a third date. A trigger rejects the second 25-card publication batch after the first has committed. The import is FAILED even though its worker cycle exits successfully: source ingestion has persisted 153 observations, while 25 app cards are current and 26 remain stale.

After removing that owned fault, a separate explicit queued import of the same complete feed brings all 51 app projections current. It inserts and corrects zero additional raw rows. Exact saved raw observations, the original failed import, three unrelated historical RUNNING imports, prior run/log records, sibling price sources and an outside-feed card remain unchanged. A second separate import preserves semantic app prices; `priceLastFetchedAt` legitimately advances. The historical imports remain RUNNING; no old completion is inferred or relabelled.

This establishes deterministic catch-up from an explicitly available complete fixture feed after an injected application write rejection. It does not reproduce a process crash, WAL ENOMEM, the original external feed or its completeness, activated archive recovery, concurrent imports, or a shared-database replay. No automatic retry or stale-job reset is added. Worker, application and database behavior are unchanged.

## Local snapshot audit and its limits

During the October 19 issue-worker investigation for #854, a consistent private Pricing archive from 05:57 UTC was compared with a separate read-only thin app snapshot from 08:03 UTC. Only Card ID, MTGJSON UUID, MTGJSON projection and price-fetch timestamp were copied; no users, authentication or image data. Before and after capture, the actual primary source maximum and complete job fingerprint were unchanged. These are separately timed snapshots, not an atomic cross-database snapshot.

The copied app has 5,735 mapped cards and 48,159 MTGJSON scope entries. The available raw ledger has 52,537 latest scopes across 5,734 UUIDs; 52,381 scopes map to copied app cards. Of matched entries, 47,778 have an older app observation date across 5,611 cards, and 381 match exactly. Of those older entries, 39,307 have unchanged amounts. There are 4,222 ledger scopes missing from app projection; their dates span July through October. The app feed projection replaces the MTGJSON subtree with that feed's scopes, while the ledger retains historical scopes. Therefore missing historical scopes are not all demonstrated bugs and must not be blindly resurrected from the union of past feeds. Twenty-eight mapped app cards have no raw backing in this archive.

This audit establishes observed projection lag relative to available observations, not that all archived raw observations constitute the complete interrupted feed or that every missing scope should be restored. Its full aggregate classification, source/archive/job canonical-content checks, timings and exact snapshots remain in the private issue-worker checkpoint. The five-summary full-copy acceptance already established for #858 is reused, not repeated here.

## Recovery boundary

#854 remains open for the WAL write failure cause, actual shared writer fencing, original feed/interrupted-job reconciliation, and shared source/summary/app recovery. The synthetic explicit catch-up result is not permission to mark the three historical jobs successful, replay an unknown original generation, reset them based on age, or claim actual data repaired. A future shared catch-up needs a pinned complete source and verified target/mapping/price-scope semantics, source conservation and a new actual-build acceptance window.

Test-only changes require no new application images. Cumulative review and the separately mapped #853/#858 pricing maintenance component remain identified in the worker checkpoint and PR. Independent review, individual merge approval and production deployment remain separate.
