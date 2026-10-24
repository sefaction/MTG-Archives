# Manual addition versus acquisition commit

Related to #309/#302. This covers the explicitly missing complete writer-first
manual-add/acquisition composition from ACQUISITION_WRITER_MATRIX.md. Product,
schema, authentication, transaction limits and capacity policy are unchanged.

The existing acquisition PostgreSQL verifier invokes the new bounded case after
the established commit cases. It creates one metadata-only, manually reviewed
photo and an empty one-space location. The actual manual-add domain writer runs
inside the same default transaction used by addSingleCardToInventory. Only its
post-stock/audit, pre-commit boundary is paused. A separate named client starts
the actual complete acquisition commit using its earlier preview. PostgreSQL
must report that exact capture backend Lock-waiting on the exact manual writer
PID within the existing five-second observation envelope.

After the manual transaction commits, acquisition must reject its stale preview.
Every public table except the three legitimately changed manual-stock/location/
audit tables must remain identical. The fresh preview shows one excess copy;
unreasoned overfill must refuse without any table changes. A separate explicit
reasoned commit creates one distinct acquisition lot, receipt, membership and
audit. The manual row and its complete audit remain unchanged, including known
opener, notes and attributes. Total stock is exactly two. Exact-request replay
must preserve every public-table full-row fingerprint. All owned rows are then
removed, including its dedicated owner/user/correction account and complete
correction-evidence graph, and every public-table full-row fingerprint must
equal the entry state.
Table fingerprints include future columns and have no volatile exclusions.

Transactions drain before cleanup and both dedicated clients disconnect
independently. Original verification and cleanup errors are retained together.
The outer opt-in, loopback/disposable acquisition_* database guard remains.

## Evidence and remaining limits

The final affected verifier passes locally against actual PostgreSQL 16 in the
private acquisition_manual309 database (October 23, 2026). The complete race,
stale/unreasoned refusal, two distinct lots, receipt/membership/audit and replay
checks pass; cleanup restores all 85 public-table full-row fingerprints. The
checked script's Git-byte SHA-256 is
ee54b33a79ef59ad8d769b11e78bfc294bd1447d54cbffba1471a69a87aecc63.
The outer integration changes only its import and invocation. Current-schema
TypeScript passes with a 1536 MiB process heap in the unchanged 2 GiB runner.

A private negative control removes only the existing stale-preview comparison
from the actual service copy. The new verifier fails at its required stale
refusal assertion (the service instead reaches the overfill-reason refusal),
still restores all 85 table fingerprints, and restores the original source in
finally. This is test-sensitivity evidence, not a newly reproduced product bug.

Two earlier full-suite attempts remain failures: the initial new case passed
its transaction assertions but its cleanup omitted correction feedback, which
motivated the dedicated owner/account graph; the next attempt stopped earlier
at verify-acquisition-orchestration.ts:315 on unordered artifact arrays, the
existing #903 boundary. The corrected affected verifier passes independently;
no complete local-suite pass or repair of that other owner's issue is claimed.
Required exact-head hosted acquisition/Core/other checks and independent review
are recorded separately on the PR; keep the PR draft while any gate is pending.

Local source inputs come from main932e305c plus this verifier/integration. All
1,038 relevant app/component/library/script/test/Prisma/config inputs match
their Git contents after explicitly normalizing CRLF to LF. The changed verifier
and outer integration are also run from exact exported Git bytes. Reused image
61aadcdbb648 supplies dependencies only; its package-lock matches the fixture,
and Prisma is freshly generated from the current schema. No native/model work
is run. Resources are two new exact-owned containers on a private internal
network, a tmpfs database, no host port/mount, runner 2 GiB/2 CPU and PostgreSQL
512 MiB/1 CPU, both with no extra swap. Admission reserves 3 GiB Docker memory,
2 GiB Windows memory and 2 GiB storage, after observing about 22 GiB available
Docker memory and 71 GiB Windows memory. Shared review/data are untouched.
Compact source manifests, run logs, original failures and exact-owner cleanup
receipts remain private in .local-data/manual309. No app rebuild/reload is
needed for this test-only change. Both exact-owned containers and the internal
network are retired after terminal child/client checks; the runtime claim is
released. The reused image and all existing review resources remain protected.

Publication reconciliation: approved retention-race PR #900 concurrently merged
as main90a5e5b8. This branch integrates that main without conflict and preserves
its two outer-verifier lines and separate new fixture/history files. No library,
schema, dependency or changed manual-writer input differs from the local pass;
that focused evidence remains applicable. Required final-head CI additionally
qualifies the combined outer-verifier execution. The local full-suite failures
above are still failures, not converted into a cumulative local pass.

This is one actual domain-service/database schedule, not authenticated form or
browser acceptance, natural storage/process/power loss, original-image or
recognition qualification, every writer ordering, broad phase acceptance or
named-installation delivery. Existing CSV/capacity/helper, invalidation #925,
browser #927 and whole-trade evidence retain their separate scope and owners.
Keep #309/#302 open; individual approval and an explicit merge request remain
required.
