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
Each next feed still requires the existing fresh source/capacity checks, private
START marker and exact execution identity. The established 600 DPI, frame,
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
