# Pasted physical deck import contention — October 15, 2026

[PR #810](https://github.com/sefaction/MTG-Archives/pull/810) repairs the deterministic contention defects in [#818](https://github.com/sefaction/MTG-Archives/issues/818). Parent [#808](https://github.com/sefaction/MTG-Archives/issues/808) remains open: Brian identifies the Unraid site, a commander deck, a non-descript black error page and **nothing added afterward**. The actual list/count, deployment revision and server error are not independently established. The local timeout/rollback is consistent with that report; it is not proof of its cause.

## Change and source

Only the full-deck commit transaction receives an explicit 30-second Prisma transaction timeout, replacing that transaction's five-second default. Its existing-row append uses an atomic quantity increment instead of assigning a value calculated from an earlier read. List-only commits use the same transaction; global transaction defaults, acquisition workers, resource settings, automatic retries, retention and sampling policies are unchanged.

Receipts, physical movements, deck-list writes and audits remain in one transaction. Ownership, League restrictions, replace-mode checks, printing/attributes and deliberate append semantics are preserved. This repair does not add automatic-retry idempotency or establish every concurrent replace/new-row scenario.

- Existing PR coverage head: 8c54b07e77cfc1ec7e4195374c22fbbfc6de1c61.
- Current main 94ecc9cb52b9d65ad722e31420c117ca829ef787 merged into that branch as 8b4b66492c7a3d0ff6308bd14bbdc47e8c23a24f.
- Application repair and initial regression commit: a575ce450a81c9056fa117a3e9dc92cea86a2e18; cumulative cherry-pick 18fbb1f4e3b0f94297c3324f5a50355095659a75, after 2ddf512dbea7c98065012d7287acd3f7ae844f4c.
- The final qualification commit adds the later-row expiry regression and this record; it changes no built application input. All three required checks pass at source a575ce4 in [run38754593268](https://github.com/sefaction/MTG-Archives/actions/runs/38754593268). Exact final-head checks are recorded in the PR and work checkpoint after publication.
- Prior #806/#810/#811/#813/#815/#817 and manual #799/#802/#804 cumulative source remains present. No unrelated source or data was reset.

## Actual unchanged-runtime negatives

Original local image/index sha256:e54387ab5942ecbea23327e0e2734c8fa36e2cb5eb7c0077c5e7741e8b003edd, manifest 0d95fcaf, binds all six relevant action/panel/parser/manual-receipt/movement inputs to the inspected source. Four library files also match actual runtime bytes. Raw app/component sources are omitted by the standalone image; their identities are build-manifest inputs, not a raw-source claim.

A synthetic 100-distinct-line commander-section list succeeds without contention: list-only303/list100/stock0/audits0, physical303/list100/stock100/audits200. These are representative fixtures, not Brian's actual list, a full Commander-legality test or a collection-scale benchmark.

The actual browser/server action and PostgreSQL then expose two failures, without mocked transaction behavior or global delays:

1. A separate connection holds only the fixture's existing DeckCard row for 7 seconds. Import returns500; sanitized server evidence reports P2028, an expired transaction and 5000 ms budget. Seeded list1 remains; stock/audits/locations are0. The correctly typed holder and exact fixture cleanup exit successfully.
2. A 1-second holder increases that existing row before releasing it. Import returns303 and creates stock100/audits200, but list101 instead of102: its stale quantity assignment overwrites the concurrent addition. Holder/fixture cleanup succeeds.

Both original FAILED expectations remain retained. A first 7-second holder also failed decoding PostgreSQL's void sleep result after its genuine wait; its HTTP500 and fixture deletion are retained separately. Correctly casting the sleep result isolates the clean original timeout negative.

## Actual compiled repaired-runtime acceptance

The permanent opt-in tests/ui/pasted-decklist-contention.spec.ts runs against PostgreSQL through the actual browser/server action. The isolated runtime adapter changes only the literal container name and loopback endpoint. All 3 new cases pass in 197,728.898 ms, zero skipped/retries/flaky; journals precede mutation and every holder/fixture cleans up.

| Controlled schedule | HTTP | Deck quantity | Physical stock | Audits | Other acceptance |
| --- | --- | --- | --- | --- | --- |
| Existing row held 7 seconds | 303 | 101 | 100 | 200 | 100 list rows,100 inventory rows; complete import |
| Existing row increased during 1-second hold | 303 | 102 | 100 | 200 | Concurrent addition preserved |
| Row 50 held 35 seconds | 500, expected | Seeded1 | 0 | 0 | 0 inventory rows, only seeded list row,0 locations |

The third case reaches the existing later row after earlier physical writes. Sanitized server evidence confirms P2028 / 30,000 ms transaction expiry; the entire import rolls back. Submission-to-observation is 36,072 ms because the blocked database query returns after its 35-second lock is released. The Prisma transaction timeout is **not a strict 30-second HTTP response deadline**. Successful slow/concurrent observations are 10,822 ms / 4,421 ms; these include browser submission, a fixed 500 ms settling wait and database verification, and are not server-only throughput measurements.

The existing reviewed-attribute regression also passes 7,255.724 ms, zero skipped/retries/flaky: list-only creates no stock, exact reviewed printing/LP/FR/NONFOIL and system deck destination persist, an intentional repeat appends expected quantities, and desktop 1440px / phone 390px layouts fit. It does not establish automatic retry idempotency.

All eight owned fixture classes are empty afterward: users, players, decks, deck cards, inventory items, locations, audits and auth sessions. Typecheck and diff checks pass. Expected failure500 in the expiry case is a passing rollback control, not an application-success claim.

## Cumulative local image and conservation

Only local isolated review web is recreated, at http://127.0.0.1:13011. No production, scanner, native inference or global resource mutation occurs.

- Tag mtg-archives:deck-contention-54454b2e; image/index sha256:fd2fac1863d82023f6c5bc195d3b4a179d74636b7b93e4d08882257003e53c4d, Linux platform sha256:c2c3b7008945ed1263f72189edb8ed0c2f373ac742aa80f8eb7ed6dc15846cad, container fe893d81c776fd4cfceb6f42131c2806d51ce2848fd4dd98ef68238b5a2d184f.
- 626 inputs exactly match manifest ff89de931370b5cbdaea90666c98fdb1409a30c486184f6fd9615b0cb10ea0bf. Only app/decks/actions.ts differs from the previous web/catalog manifest; its build-input SHA256 is 3263419f58dd98d6d3a5094dd5ff2b0619a3575f0390a14a8a2fd5daa3358de3. All 332 actual lib/scripts files match bytes. The changed compiled action is qualified by the real controls above.
- Full 48 Config/label/individual environment hashes permit only planned image/hostname/Compose metadata and environment array ordering. All environment values, complete HostConfig and mounts are exact. A Memory+1 negative is rejected. HTTP200, zero web restarts/OOM and the later post-test identity/lifetime observation pass.
- All 22 peers retain exact identity, images, full Config/HostConfig/mounts and lifetime state; all six native-role failure-event counters and native model generations are unchanged. Historical primary printing OOM/restart and earlier 755/777/791/803/812 failure intervals remain historical failures/unknowns.
- Catalog remains image e54387ab / manifest 0d95fcaf, differing from web only in the unused app action. Native application manifest remains e48219dc; differences from new web are lib/backup.ts, lib/acquisition-auto-confirm.ts, scripts/verify-acquisition-commit.ts and app/decks/actions.ts. Native roles do not execute the changed deck action; no identical-source claim across all roles is made.
- After all temporary owned writes/cleanup, paired primary originals remain 157 files / 904,889,236 bytes: acquisition manifest a0029473b7055527020629181b64b61729e6a77ad85a0e86dc2cc4e27b8a78e0, correction manifest 2f200be969ebe0da08e41ef2a8a9a41e3837fef0df7d97f28adc7786ddea8b4f. Catalogue 118505 total/109292 paper and projection 15ea2bf28301d311017fd1f432798ea0, entire isolated upload manifest and 11 actual review-table fingerprints plus one absent-table marker are exact. Only the canonical web image pointer changes.

## Retained setup failures and limits

Initial guards incorrectly requested raw standalone app/component files, then misquoted the correction into a host/app read. The corrected six-input/four-library identity proof passes without product or fixture changes. The first browser harness used a 5-second readiness assertion before progressive 100-line resolution finished; a longer harness wait allowed the unchanged baseline comparison. Those are setup failures, not report reproductions. An aggregation guard assumed reporter output was relative to cwd; locating the unique existing config-relative reports corrected it without rerunning accepted tests. The copied conservation helper's initial no-mutation caption refers to paired final state: transient owned fixture writes did occur and all final fingerprints are restored; clarified evidence records this explicitly.

Private evidence stays in feature-worktree .local-data/deck-scale-qualification; credentials, sessions, raw private messages and traces are not published. #818's demonstrated existing-row contention scope is locally qualified. #808 still requires correlation or validation of Brian's actual installation/workflow after separate review, individual approval, merge and deployment; its reported lack of additions is recorded without inspecting production. No broader batch-size/latency, new-row/replace concurrency, retry, legal-deck, recognition-accuracy or production acceptance follows.