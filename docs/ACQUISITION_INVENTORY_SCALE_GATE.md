# Review qualification with a large stored collection

This local-only opt-in extends the existing 300-image, four-owner native queue
and paged review test. It uses disposable owners with uneven 144,000 / 5,000 /
900 / 100 physical copies, represented by 16,400 Inventory rows and 5,000 cached
printings. The storage tree contains 227 parent locations, 2,270 children and
four fresh scan destinations. It creates no new catalog printings.

Set `MTG_ACQUISITION_LARGE_BATCH_INVENTORY_SCALE=1` alongside the existing
local pilot, large-batch, count=300, private corpus and report-path opt-ins,
then run `tests/ui/acquisition-large-batch.spec.ts`. The ordinary empty-Inventory
100/300 modes remain available. This is a test-only change; the loaded application
must match the parent runtime manifest before running it.

The native targets remain 160/80/40/20, with the same finite upload concurrency,
five-minute per-owner upload limit and 45-minute native completion limit after
uploads. Review checks every paged candidate, original/native digest, manual
acceptance policy, saved correction through reload and desktop/phone overflow.
Inventory row/copy/full-record fingerprints must remain unchanged for each
fixture owner; reviewing scans must not add or mutate stored cards.

The report records actual seeded counts, separate seed time, authenticated
Inventory request samples, before/after worker continuity and cleanup. Cleanup
removes only generated owners' Inventory in bounded 500-row pages, then child and parent locations, and
their acquisition records/files. The existing global Inventory fingerprint must
match the pre-fixture snapshot after cleanup. `passed` remains false until
cleanup and conservation assertions finish.

This gate repeats 67 preserved development images. It does not qualify independent
printing accuracy, physical card counting, operator throughput, 150,000 database
rows or every recovery/release requirement in issue #310. Request samples are
reported individually; no latency target is inferred from the samples.

## Current result

The first run at `c1bd9b5` **FAILED overall** (33.7 minutes, actual exit 1).
All 300 uploads/digests were ready in 128.768 seconds including 16.981 seconds
of fixture creation. Native printing finished in 1,927.795 seconds from start.
Every paged review row, four saved corrections/reloads, desktop/phone overflow
and stable worker generations passed. All 24 authenticated Inventory requests
returned 200 (153–7,404 milliseconds); the largest owner samples were
7,404 / 5,631 / 4,232 / 3,228 / 3,338 / 2,043 milliseconds. These few sequential
measurements are descriptive, not an operator throughput target.

Cleanup exceeded the existing 30-second Docker-operation limit. Its first
container operation continued after the host client timed out and eventually
removed the largest owner, while the three subsequent accounts remained.
The report correctly stayed `passed=false`. Issue #640 records this harness
defect. The original failed report/log and all eight review screenshots are
preserved privately. No limit was increased to accommodate it.

Bounded cleanup subsequently removed only those exact remaining fixture accounts
and their 1,400 Inventory rows. All fixture accounts/sessions/locations/Inventory
are now zero; the original 10,292 rows / 12,495 copies and full-record checksum
match. A fresh full unchanged native gate is still required after this repair;
the first failure remains a failure. The prior parent empty-Inventory native300
and actual OCR24 recovery passed separately.
