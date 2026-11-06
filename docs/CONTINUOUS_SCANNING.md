# Continuing one scan batch

Related to #1005. A scan remains one logical batch while the server partitions
count-controlled fi-7160 work into feeds of at most 500 images. Completing a clean
internal feed queues the next feed automatically with the same owner, destination,
settings and logical batch. Physical positions continue across feeds. Neither a
new batch, review nor cleanup is required at that internal boundary.

An optional requested count and actual destination capacity remain stopping
conditions. With no count or known capacity, the logical target is unset and the
batch continues until stopped. An empty hopper pauses for explicit refill; driver
errors, uncertain transfers, Stop, a stopped section series, revoked/stale helpers,
changed destinations and reduced available capacity cannot authorize another feed.
Continuation IDs are deterministic across rollback and database restoration. Each
next feed still requires fresh source/capacity checks, a private START marker and
exact execution identity. An older START preserves its original epoch/execution
and forces reconciliation; a durable prior cancellation cannot start another feed. The established 600 DPI, frame,
Pre-Pick, count, transport and recovery protections are unchanged. This source
change does not authorize physical scanner operation or production installation.

No retained-original account or batch allowance blocks intake. Each original
retains its existing individual size, dimensions, digest and immutable-write
checks. The server still requires 2 GiB free plus the incoming file; actual disk
exhaustion/quota errors leave uploads retryable with the same physical identity.
Scanner-computer disk reservation, durable spool and upload replay remain intact.
No unreviewed original is deleted to make room. See [storage](SCAN_PHOTO_STORAGE.md)
for the preserved cleanup policy and legacy environment settings.

Saved-card review loads at most 100 positions per page. All pages remain reachable
while capture continues. Filters, page counts, bulk review and Inventory selection
apply to the displayed page, and unsaved edits block navigation. Matching-file
warnings count the entire authorized batch. Global physical allocation is checked
independently of the displayed page, including for explicit Inventory commits;
later-page selection must never turn overflow into an allocated card. Image reads,
review saves, command handling, creation recovery and selected commits avoid
loading every earlier card. Physical IDs, reviews, receipts and Inventory authority
remain separate from file identity and processing completion.

## Verification

`tests/acquisition-continuation.test.ts` executes the actual finish function across
continuation, replay, final target, Stop, empty feeder, error, stale/revoked helper
and capacity reduction. Photo-admission/access controls cover replay, conflicting
bytes, disk-full guidance and existing privacy/availability rules.

`verifyAcquisitionContinuation` in
`scripts/verify-acquisition-continuation.ts` uses disposable PostgreSQL only. It
explicitly seeds 4,500 historical physical identities with exact synthetic
originals, then runs 1,001 real server transfers across automatic boundaries and
the former 5,000 sequence/staging limits. It checks every saved position and page,
cross-page duplicate counts, foreign-owner refusal, original bytes, pending-data
retention, empty-hopper refill, Stop through the original batch ID, and a later-page
review/Inventory commit/replay. Optional large originals cross the former default
aggregate-byte allowances; synthetic hard links share fixture bytes without
collapsing physical identities. Cleanup compares every public table's row count
and full-row fingerprint. Seeded history is not a claim of 4,500 actual transfers,
physical feeds or native recognition outcomes.

Current local/hosted results, source bindings, failed setup attempts, resource
observations and desktop/phone review remain recorded with the PR. #1004's severe
production progressive-fill report remains unresolved; bounded reads and paging
do not establish its historical cause or installation performance acceptance.

## Author qualification — November 6, 2026

[PR #1012](https://github.com/sefaction/MTG-Archives/pull/1012) contains the implementation. The final product build is bound to `3ca0e6e1`: all 529 product inputs match Git bytes exactly from an LF archive. All 439 installed package version/integrity entries match the lockfile; 82 platform-optional entries are absent. Earlier CRLF archive/raw-Git binding failures and the earlier 528-input archive qualification remain preserved separately. Later handoff changes affect documentation only; final exact-head CI receipts are on the live PR.

Full types, separate production compile/generate phases, client manifests and lint pass. Lint retains the unrelated existing Inventory ref warning. All nine Verify checks and the Windows scanner check pass at `3ca0e6e1`. Twenty-three focused controls pass. The earlier serial local run has 2,561 passes, one existing skip and two missing-Git setup failures; both unchanged Git-dependent tests separately pass on Windows. Current-head hosted Core supplies the complete stable-source check.

The valid-large-original case retains 5,501 physical identities and 8,704,413,833 logical original bytes after 4,500 explicitly seeded historical records and 1,001 real server transfers. Repeated counted-scanner/continuation workflows conserve all 85 tables after cleanup. Current CI adds a real durable START/database-rollback probe: the same continuation ID preserves its genuine saved epoch/execution, refuses another feed and restores every public-table fingerprint. A separate retained-fixture rerun preserves the original marker bytes as well. The initial reconciliation prototype was refused by the unchanged database constraint; its correction preserves the real execution identity rather than inventing one or weakening that constraint.

Other controls preserve late-finalization receipts, expiry and conflicting same-slot serialization while allowing distinct pending uploads past removed allowances. A later-page overflow refusal changes no public table. A separate 16 MiB photo filesystem exercises actual free-space refusal; retry in a new process on normal storage retains its epoch/photo identity and produces exactly one slot, photo and preparation job. Those original-byte/admission behaviors are unchanged by the final recovery guard.

The final production build passes desktop 1366px and touch-enabled 320px newest/page-number/previous navigation across 56 pages, whole-batch matching-file warnings and private original delivery. Both layouts have no horizontal overflow or page errors; browser review conserves all 85 public tables. The reviewed JPEG remains 1,582,333 exact bytes with digest `71f24ad6c9c98fe29c49e7a76a5b69371579e3c1f0ab84af33206ffa8356d2c3`.

Failures remain preserved: heap/generated-client setup, runner/adapter mistakes, newline refusals, a 176.297-second correlated artifact query, initial receipt/obsolete-quota CI assertions, the reconciliation constraint and duplicate-epoch type refusal. Direct selected artifact/correction IDs repair the reproduced scaling case without extending its transaction timeout. Original receipt assertions remain; obsolete quota expectations follow the agreed continuing-intake behavior, with an added conflicting-slot race. None of these results diagnoses #1004’s historical production incident.

The reviewed app, database and loopback proxy are retained stopped for future owned review; obsolete test containers and the temporary disk-test volume are retired. Runtime ownership is released after terminal cleanup. Named-installation deployment, physical operation, recognition accuracy, independent review and reporter acceptance remain separate. No merge or production change is performed.
