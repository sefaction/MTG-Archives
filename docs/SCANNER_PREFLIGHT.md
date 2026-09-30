# Scanner preparation and recovery

Issue #518, under the scanner user workflow audit (#501/#506/#511).

## Behavior

Helper 0.3.4 checks the source, free spool reserve, per-device lock, current
discovery, feeder capability and driver preparation before making a START claim.
A failure reports one bounded code on its owned queued run. Scan cards gives
USB/power, other-app, storage, feeder-source or driver repair guidance. The helper
retries using the same run. A successful authorized claim clears that message.
Cancel waiting scan retains the existing pre-start cancellation behavior.
New scanner batch is offered after reconciliation; a still-active run cannot
accidentally lead to another unfinished batch. Its action wraps as a whole button.

The nullable `ScannerRun.preflightProblem` column is separate from a physical
run outcome. Reports contain no native paths/messages, credentials or images.
They cannot authorize a motor, create an artifact, change physical counts or
commit Inventory. Current owner/agent, epoch, queued phase, no execution,
no stop/reconciliation and no durable START marker are required. Repeated codes
do not write a new timestamp every poll. A restored database cannot overwrite
independent START evidence with a misleading no-feed preparation problem.

The generic scanner boundary and recognition algorithms are unchanged. Backend
and device lock are disposed after failed preparation. A prepared backend is
transferred to the existing durable journal/claim/upload lifecycle.

## Verification and limits

- Release build: zero warnings/errors. Native selftest covers eight simulated
  failures (cached/current source absence, busy lock, discovery/capability/prepare
  exceptions, unsupported feeder and unwritable spool structure), no claim or
  native start on failure, backend/lock disposal and same-run recovery. Existing
  ACK-loss replay, journal/epoch/receipt fences and original-retention tests pass.
- Disposable PostgreSQL acquisition and shared import integrity checks pass,
  including safe reports, repeated code, wrong agent/run/epoch, clear on claim,
  rejection after START/cancel and restored-database START-marker fencing.
- Browser qualification passed with a disposable authenticated protocol agent, not a
  physical scanner: readable statuses, reload, desktop/320px, authorized claim
  clearing, rejected late reports and pre-start cancellation. Run with
  `MTG_LOCAL_PILOT_TEST=1 npm run ui:test -- tests/ui/scanner-preflight.spec.ts`.
- Low-space text/schema is checked, but the laptop disk was not filled. Physical
  USB/driver failure, fresh 600-DPI card feeding and native driver hangs remain
  hardware observations, not claims made by these fixtures.
- Driver errors are grouped safely; no exact vendor status interpretation.
  Discovery blocking before a run, post-preparation journal I/O/claim denial and
  active-run authorization loss remain separate audit concerns.
- This PR depends on #517/#513. Independent #516 must ship with the helper stack
  for correct temporary-outage versus revocation handling. No production change,
  hardware operation or merge authorization is implied. Installer distribution
  notices/source and clean-host prerequisite gates remain open.
