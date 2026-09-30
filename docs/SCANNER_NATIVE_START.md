# Native scanner batch delivery

## September 29 feeder and review revision (local validation)

The next scanner/review batch follows the user's local test of the PS286. New
runs default to 600 DPI; 300 remains an option. The normal simplex command
feeds until the source returns naturally. It no longer asks for a loaded-card
count or a second emitted-card count. The destination's remaining capacity is
shown before START and checked at claim; any captured overflow remains saved
but cannot be silently committed. Stop still drains and does not promise
stop-at-N. Existing counted runs keep their original reconciliation behavior.

On a clean natural end, the site records an explicit **one retained front image
per card assumption** and marks the associated physical candidates counted.
This is based on complete, sequenced, ready originals and a matching candidate
count, not on SDK sheet boundaries or a device counter. A double feed without
an image or native error could still go undetected. Errors, stops, missing
transfers and inconsistent candidates retain the manual reconciliation path;
originals remain recoverable. No scanner helper commits Inventory.

New batch review defaults are nonfoil and near mint, with per-card overrides.
When catalog metadata says a proposed printing supports exactly one finish,
that sole finish is preselected for the card (for example, foil only). Ambiguous
multi-finish printings retain the batch default if valid and otherwise need
individual correction.
Bulk Confirm Match previews every current proposal selected by default and
shows source/printing images before saving reviews. It uses the existing
revision-checked review command for each selected card and reports failures;
the separate Inventory confirmation remains mandatory. The side-by-side
review images are larger on desktop. Recognition accuracy and thresholds are
unchanged.

The user also reported a Plustek `TWAIN_Proxy.exe` runtime dialog after
connection. Five local helper services and more than 900 NAPS2 workers were
observed; after the user confirmed no scan was active, only those helper
services and their workers were stopped. WIA-only discovery created zero TWAIN
workers. The revised helper reuses one discovery backend, caches TWAIN sources
for that backend's lifetime, and avoids TWAIN worker startup for a selected
WIA run. This reduces repeated driver calls; it does not prove that the
Plustek TWAIN driver itself is fixed. See #511. The installed helper has not
been replaced yet.

Current implementation branch: `feat/native-scanner-runs`, based on separately
unapproved #502 and #474. Tracking #501/#311. Recognition #463 remains
open/deferred. No production operation.
The user-provided production origin is `https://mtgarchive.graymaiden.com/`.
It belongs in the helper's site-bound setup after separately approved rollout;
current implementation and validation use local Docker only.

## Implemented prototype

The existing batch screen can select a current Windows helper/source, an
operator-loaded simplex quantity, destination/section and 300/600 DPI. The
server creates an ordinary acquisition session with a scanner provider and
logical allocation; it checks remaining capacity again under the shared
Inventory destination lock before authorizing the motor. A queued stop cancels
before claim. Once claimed, stop is explicitly unsupported/drain, never native
cancellation. Only the helper's own account can use the assigned session.

Run identity, settings, device/source and final SDK status are control metadata.
Every transfer uses existing AcquisitionCaptureSlot/AcquisitionPhoto storage,
originals, preparation, recognition, review and explicit Inventory commit. The
full scanner image uses CARD_SCAN; no new crop/OCR/recognition implementation.
Scanner sequence is retained across out-of-order delivery and ACK retries.
Metadata distinguishes requested settings from UNKNOWN negotiated settings,
and retains SDK side/boundary uncertainty. Overflow is saved rather than cut
off at the target. The helper cannot commit Inventory.

Transfers initially become provisional detections, not counted physical cards.
The operator must confirm actual emitted count, one front per item, empty
feeder/transport and no jam/double. Straightforward matching batches can confirm
counts in bulk. Count mismatch/overscan remains retained and blocked from bulk
confirmation; a fuller individual reconciliation workflow is still required.
Printing review and physical count confirmation are separate.

The helper persists its run lock/binding before network claim or motor start.
Existing run directories recover originals only and never restart the scanner.
The server also keeps an immutable start marker under persistent uploads,
outside the database/image, to fence rolled-back unclaimed state. Run generation
must match the site's persistent epoch. Recovery rechecks file digests and
server receipts; differing identities require reconciliation. No originals are
deleted on errors, stop, revocation, capacity rejection or missing ACK.

## Current checks and limits

- One real PS286 Pro WIA scan used the website START button against local Docker
  on September 29, after fresh operator confirmation of one expendable card.
  The helper retained and delivered one unchanged original in 3.364 seconds;
  its full card/footer are visible. Ordinary preparation, visual retrieval,
  OCR, catalog and printing verification completed. Review proposed the correct
  Sundering Archaic, SOS #3 printing and left human match/finish/condition
  decisions open. The operator confirmed one undamaged card exited, empty
  feeder/transport, and no jam/double/dialog. Physical count was separately
  confirmed as OPERATOR with SDK boundary/source-exhaustion UNKNOWN. No Inventory
  copy was added. This is one-card local evidence, not a feeder-stop, duplex,
  multi-device, large-batch or production acceptance claim. Private original,
  browser images and run data are retained under owned local test state.
- A second real website-controlled PS286 WIA 300-DPI simplex run used five
  expendable cards with operator-confirmed loading order. The SDK returned five
  originals in 6.291 seconds; the helper and server retained all five with
  matching SHA-256 digests. The operator observed five undamaged cards exiting
  in order, empty feeder and transport, and no doubles, jams, marks or dialogs.
  Physical count was then confirmed separately in the website; all five
  candidate counts are confirmed, with zero Inventory changes. Existing
  recognition/review proposed the visually observed name, set and collector
  number for all five (Evershrike's Gift ECL #15, Sundering Archaic SOS #3,
  Transcendent Archaic SOS #5, Armored Armadillo OTJ #3, Crystal Fragments
  FIN #13). Finish and condition remain unchosen and all five await human
  review. This is a single local feeder batch, not an independent recognition
  accuracy estimate or evidence of exact stop/duplex/device boundaries. The
  SDK still reports physical boundaries, sides and source exhaustion as
  unknown. All 45 ordinary processing jobs completed without error. Desktop
  and 320px review had no page-wide overflow; private
  originals and screenshots remain local.
- Website START through the actual Windows fixture helper and saved-source PNG
  also passed local Docker end to end in 67.4 seconds: original digest preserved,
  ordinary recognition/review found Sunblade Samurai, responsive 1366/320
  screenshots passed, declared fixture count confirmed, zero Inventory changes
  and owned fixture cleanup. This is protocol evidence, not a second scan.

- Disposable PostgreSQL/core guards passed: scoped claim/replay, current
  authorization, source/sequence/digest replay, retained overflow, operator
  counts, independent start-marker rollback fence and zero Inventory. These use
  generated fixtures, not hardware or independent recognition measurements.
- Windows locked build passes with zero warnings/errors. Native selftest uses
  the actual HTTP/spool recovery code with a controlled handler: lost ACK,
  duplicate run, epoch/binding/receipt mismatch, retained original and zero
  backend constructions. A compiler/selftest pass does not qualify the motor.
- The website/helper/ordinary-native-recognition browser check passed again
  against the final cumulative local Docker build. Its guarded local fixture
  adapter copies a preserved PNG unchanged through the same backend boundary
  and transport; it cannot connect to production and makes no physical-feeding
  claim. Fi-7160 hardware/driver qualification follows arrival.
- Helper spool, secrets and control journals live in LocalAppData/MTGArchives,
  outside executable/images. Server originals/control markers live in persistent
  UPLOADS_DATA_PATH. Native binaries are excluded from Linux image context.
- Binary distribution/license inventory, active fault/backpressure status,
  individual mismatch recovery,
  stale-command handling and production restore epoch rotation remain gates.
  Restoring both database and control files requires an explicit new site epoch;
  the current marker test proves database-only rollback, not a full disaster
  recovery procedure. Do not claim the production goal complete.

## Local helper original retention (dependent batch)

The scanner PC's original PNGs remain in private LocalAppData while a batch is
unfinished, uncommitted, mismatched, awaiting server purge, or unavailable.
After the ordinary seven-day committed-photo retention worker removes server
bytes and marks the matching photo purged, an authenticated helper check can
retire only that exact local PNG. The site verifies helper ownership, run/epoch,
operator reconciliation, artifact/slot/photo/digest and an aged commit receipt.
The helper verifies its receipt and file digest again before deleting the PNG.
Run binding, event journal and manifest remain as replay fences and diagnostic
metadata. A bounded sweep runs every five minutes while `serve` is active;
inaccessible or ambiguous runs stay untouched. No scanner is constructed by
retention checks. This does not provide recovery of originals after both
copies have passed retention; external backups cover that historical case.

## Local-only mechanical commands

Build the locked .NET project as in tools/scanner-agent/README.md. `report`
remains discovery-only. `serve CONNECTION-ID` now polls website scan commands;
do not run it with a pending real-device batch until the operator confirms the
current feeder/transport. Native SDK cancel is not used by this website flow.

```powershell
dotnet Mtg.ScannerAgent.dll native-selftest
# No device enumerated or constructed.

# Only for opted-in local browser tests, on a --local loopback connection:
$env:MTG_LOCAL_PILOT_TEST = '1'
dotnet Mtg.ScannerAgent.dll fixture-server CONNECTION-ID PRIVATE-PRESERVED.png
```

The fixture adapter is not a scanner profile or alternate acquisition pipeline.
It copies original bytes and reports `backend=fixture`; requested settings are
not measurements of that saved image. It must not count as a new physical or
held-out recognition sample. Run the real physical test separately.
