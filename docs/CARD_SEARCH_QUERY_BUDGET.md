# Card-search transaction budget — existing #846

## Current integration — November 1, 2026 UTC

Integrated main `3c2f95c9`, including the user-approved League paste policy in #990. Name-only fallback can select a recognized card from the general catalogue when no League copy exists; the review retains its quantity and labels it outside the pool. The explicit owned-only option still avoids external lookup and cache writes when linked stock is absent.

The complete manual-search, cache-upsert and printing-picker functions are unchanged from the qualified repair below. The current cheapest-printing helper equals current main with only the previously qualified sequential cache block substituted. Main's removal of the League-only filter and permission for catalogue fallback remain intact. The binding check initially refused a whole-function equivalence claim because those policy changes are real; that refusal is retained privately.

All seven original applicable cache-budget/failure test bodies remain exact. The eighth control's default League rejection was superseded by the explicit user policy: the initial integrated run recorded 22 passes and that one outdated expectation failed. Its replacement verifies outside-pool fallback, eight copies, deterministic selection, at most 75 cache writes and one active transaction. A separate owned-only control retains the no-fetch/no-write guarantee. The nine budget controls and 15 current exact-feedback controls pass; 39 additional search, metadata, pricing, review and save-feedback controls pass. Current typecheck and exact-head CI are recorded with the publication receipt.

The compiled PostgreSQL/browser evidence below remains tied to its stated older source and image. It demonstrates the original per-request cache fanout and the unchanged sequential repair; it is not a new cumulative or League-fallback pressure run. No production change, issue closure or merge approval is implied.

## Original qualification — October 31, 2026

Name-only deck resolution previously opened up to 75 independent card-cache transactions in parallel; manual search opened up to 20; the deck printing picker started up to its requested result limit. Each upsert owns an interactive Prisma transaction. These paths can compete for shared PostgreSQL slots independently of the final League gate repaired in #986. This is a separate bounded repair, not attribution of #808 or a complete production pool/leak diagnosis.

All three loops now await one cache write at a time. Existing result limits, returned manual choices, cheapest-printing ordering, exact matching and League restrictions are preserved. A failed write stops starting additional transactions; earlier successful public metadata cache writes remain, as before. No deck, Inventory, commitments or audits are changed by these lookup helpers. The price-preserving upsert transaction is unchanged.

Eight actual-module regression controls pass. On unchanged merged source 3484b2a0, six intended controls fail and two pass: one-slot manual/deck lookups fail, and both paths continue starting writes after a failure. The patch passes all eight. Thirteen exact-feedback controls and 50 applicable metadata/Pricing/import safety controls pass; typecheck passes. The initially supplied nonexistent pricing filename did not run; the actual existing metadata/Pricing suites were subsequently selected and passed.

## Compiled PostgreSQL and browser evidence

The unchanged published source3484b2a0 image863a6cd98d7a reproduces an inline too-many-clients failure for one name-only Forest lookup returning75 synthetic printings. PostgreSQL has20 slots, the app pool limit is16 and eight known peers hold connections;16 clients including the observer were measured before lookup. No deck/Inventory/audit writes occurred; public cache writes can be partial. The final control restores all85 table fingerprints.

The repaired compiled image af5266bd1fc16fc51d244d2318fcde5aacf8d90c07641174c7e77fa6c646402e passes all six cases at1366px/320px: name-only deck resolution selects the deliberately cheapest printing17 and saves8 copies; authenticated manual search returns25 choices/caches20; authenticated deck printing search with explicit limit30 returns/caches30. Eight peers remain active on the same20-slot/16-app-limit configuration. The final positive runs measure17 clients including the observer, compared with16 in the negative control; these are reported counts, not an identical full connection census. Every completed case restores all85 table fingerprints. No Inventory/audit writes or uncaught page errors occur.

Local source bb7828a6 matches remote full tree304c5ad313bc9bc7f9d7bb0ed6292cc62df5b1ca. All1,335 raw build inputs match the local manifest e49212d2842a9ab5b50310b806f2500f8268f8bcbb46dbcffa4145bf1e9e6772; canonical tracked source was clean. Host checkout line endings are bound by that raw manifest. This is a local review image, not a published production release. Two builds were run because the related printing-picker loop was identified after the initial two-path build.

## Failed harness attempts and cleanup

The first negative attempt made a post-failure SQL observation after the request had consumed every slot; the observer itself was refused. The second incorrectly required an uncaught P2037 log entry, although the importer catches the error and returns inline feedback. Both failed attempts restored all85 tables. The corrected final control asserts the actual too-many-clients review feedback and records the failure without requiring an unused log surface.

The first positive import passed its behavior assertions, but cleanup omitted the automatically created synthetic deck location and failed a Player foreign-key check. Exact synthetic identities and the failed state were retained privately; scoped removal of that location/player and the75 known card IDs restored all85 baseline fingerprints. All six final cases pass with corrected cleanup. No failed attempt was counted as a completed passing control.

Both owned temporary containers and network are retired, the exact search846-query-budget-20261031 runtime claim is released, and four pre-existing stopped containers and their mounts are unchanged.

No production write or deployment is authorized by this branch. #846 remains open for named-installation capacity/lifetime evidence; #808 remains unattributed. Multiple concurrent requests can still exhaust a shared database; this removes the demonstrated per-request cache fanout.
