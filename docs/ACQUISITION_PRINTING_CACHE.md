# Printing reference cache headroom

The local seven-input native/review check sampled the printing container at
1020 MiB against its 1-GiB limit. Its reference cache retained up to 48 decoded
images, normalized registration images and SIFT descriptors, regardless of byte
size. This is a concrete headroom risk before larger batches; it was not an OOM.

The cache now keeps the existing 48-entry LRU limit and also limits retained array
payload to 128 MiB. Recently used entries remain warm. A single larger reference
still returns unchanged decoded pixels/features to its caller but is not retained
and does not clear smaller warm entries. Re-reads continue validating the public
reference hash. No image resizing, localization, SIFT/registration/stamp policy,
confidence threshold, candidate or automatic decision changes are introduced.

The payload counter covers decoded/registration images and descriptors, avoiding
double counting the same array object. It is **not total process RSS**: Python and
native objects, keypoints, full catalog metadata, photo decoding, allocator peaks
and the Node parent remain outside it. Existing input/request limits remain.

## Isolated qualification

Fifteen model-free printing/cache guards passed with the existing native stack.
The new cases exercise LRU eviction, byte and count limits, warm object reuse,
oversized-reference pass-through and integrity rejection on an uncached re-read.

`tools/acquisition-eval/profile_printing_cache.py` is an opt-in read-only Linux
native-image helper using the existing `/visual/index`, `/visual/references`,
`/app/tools/acquisition-runtime` and `/eval` mounts. It enumerates the first 48
sorted public reference identities, hashes unchanged decoded and SIFT data/state,
and re-reads five after eviction. It prints metadata, memory observations and
public reference identities; no card photo, database, credentials or image output.
Run both versions against the same frozen public index in disposable containers
with network disabled, one CPU and 2 GiB. The helper is not a recurring service.

Both versions used the full 112,474-reference metadata manifest. All 48 decoded
pixel/registration/SIFT/stamp-state fingerprints matched, and both preserved
features/state on re-read. Retained arrays fell from 309,291,136 bytes / 48 entries
to 129,332,960 bytes / 20 entries. Python peak RSS fell from 924,724 to 737,884 KiB.
These are isolated public-reference observations, not an exhaustive full-container
or private-photo peak. Elapsed times were 25.987 and 27.392 seconds under other
local activity; they do not establish throughput or a timing regression.

Exact sanitized provenance/results are in
`tools/acquisition-eval/printing-cache-results.json`. The registration source hash
changes the existing immutable printing descriptor; evidence/version fences and
saved human decisions must remain intact through the ordinary pipeline.

## Delivery status

Independently based on current main after approved #497, not on an unapproved
recognition branch. Unapproved recognition/review/admission PRs may be included
only in cumulative local review. Live pipeline/resource and larger-batch checks
are required before readiness. The cache is loaded locally with verified source
and a new immutable printing descriptor. All seven printing jobs finished in
the first live check, but two whole-photo OCR hints timed out and the expected
name assertion failed before UI/correction/reload checks. That remains a failed
acceptance check, with private trace and evidence preserved; no cache output
regression has been established. A separate completed-reading fix is being
qualified in #493, without changing the cache's independent main base.

The combined local #493 amendment and this unchanged cache then passed the
seven-input native/browser gate in 361 seconds. All names were offered first,
printing completed, original raw evidence and manual decisions were preserved,
and Simple/Advanced, correction/reload, location/section, desktop/phone images,
zero Inventory and owned cleanup passed. Sanitized exact build/native identities
and scope are in `photo-text-pipeline-results.json`; recognition/UI siblings are
cumulative testing only. This supports review of the cache change without
claiming the separate larger-batch or total-memory gates passed.

The opt-in `tests/ui/acquisition-large-batch.spec.ts` exercises 100 logical
inputs, or a separate 300-input stress case across four uneven owners, through
ordinary local ingestion and native queues. It verifies input conservation,
manual decisions, paged review, corrections/reload, worker state and zero
Inventory writes, then cleans only owned fixtures. Its repeats of 67 development
scans are resource/recovery data, not independent physical or printing samples.
The 100-input run failed its unchanged 20-minute printing gate with 57 results;
all 100 inputs were ready in 42.2 seconds and preserved in the observed
photo/artifact/slot/candidate counts. Owned fixtures cleaned to zero users,
sessions and Inventory records. No failed jobs appeared in the stage snapshots,
but 100-card review/correction/reload assertions were not reached. This does not
qualify throughput or justify widening the gate. The 300-input case has not run.
The first harness exceeded Playwright's 50-MiB
in-memory transfer limit before upload; private temporary file copies avoid that
harness limit without changing app upload behavior. Authenticated fixture-page
fetches and sampled container readings do not qualify a 150,000-copy Inventory
or exhaustive memory peaks.

Container-lifetime cgroup readings, including preceding runs, found zero OOM
kills or restarts. Printing nevertheless reached its 1-GiB memory limit with
1,660 limit encounters. Its lower sampled usage and the isolated Python RSS
reduction are not a whole-container peak guarantee. Sanitized source identities,
counts, timings, cleanup and counter scopes are in `large-batch-results.json`.
The published checker adds conservation/digest assertions before the printing
wait and lifetime counters on failure; type/lint/query shape checks passed, but
those added assertions have not been rerun through another 100-input batch.

Production, Compose/env and physical scanners are unchanged. #463 remains
incomplete; automatic hybrid confirmation remains off.
