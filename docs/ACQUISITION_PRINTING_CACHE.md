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
are pending before readiness. Production, Compose/env and physical scanners are
unchanged. #463 remains incomplete; automatic hybrid confirmation remains off.
