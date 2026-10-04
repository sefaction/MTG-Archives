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
removes only generated owners' Inventory, then child and parent locations, and
their acquisition records/files. The existing global Inventory fingerprint must
match the pre-fixture snapshot after cleanup. `passed` remains false until
cleanup and conservation assertions finish.

This gate repeats 67 preserved development images. It does not qualify independent
printing accuracy, physical card counting, operator throughput, 150,000 database
rows or every recovery/release requirement in issue #310. Request samples are
reported individually; no latency target is inferred from the samples.

## Current result

Prepared; not yet run. Preserve the actual terminal result and report before
claiming qualification. The prior parent 300-image empty-Inventory gate and
24-image OCR crash/recovery gate passed separately.
