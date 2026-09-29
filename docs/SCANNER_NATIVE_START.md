# Native scanner batch delivery

Current implementation branch: `feat/native-scanner-runs`, based on #502 at
839cc9b and separately unapproved backend #474. Tracking #501/#311. Recognition
#463 remains open/deferred. No production operation or new physical scan.
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
- Website/helper/ordinary-native-recognition browser check is pending. Its
  guarded local fixture adapter copies a preserved PNG unchanged through the
  same backend boundary and transport; it cannot connect to production and
  makes no physical-feeding claim. Real PS286 acceptance still needs fresh
  operator setup; fi-7160 hardware/driver qualification follows arrival.
- Helper spool, secrets and control journals live in LocalAppData/MTGArchives,
  outside executable/images. Server originals/control markers live in persistent
  UPLOADS_DATA_PATH. Native binaries are excluded from Linux image context.
- Binary distribution/license inventory, helper original expiry after verified
  server commit, active fault/backpressure status, individual mismatch recovery,
  stale-command handling and production restore epoch rotation remain gates.
  Restoring both database and control files requires an explicit new site epoch;
  the current marker test proves database-only rollback, not a full disaster
  recovery procedure. Do not claim the production goal complete.

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
