# Scanner detection while a driver is pending

PR #536 addresses #534, on individually unapproved #535/#528 and scanner parents.
Independent review/recognition changes are only in cumulative local Docker.
This is local acceptance, not merge or production deployment authorization.

## Lifecycle and user behavior

The background helper tracks exactly one device discovery Task per backend.
The service loop starts it off-thread because a driver/library can block before
returning a Task. It harvests only an actually completed Task. A 250-ms initial
observation window lets fast discovery settle before a pulse, avoiding a routine
five-second busy flicker. Expiry returns to heartbeat with the **same** task;
it does not signal native completion or create a replacement worker.

Heartbeat continues during pending discovery. Previously completed device
choices remain a snapshot, preserving selected source and destination. They are
not proof that a scanner is currently ready. The website reports **Checking
scanner drivers** and keeps Start disabled for that computer until completion.
Other connected computers can still be selected. Initial discovery publishes
no devices before its result. The helper cannot poll/prepare/authorize a new scan
while discovery remains pending, including a browser request racing a pulse.
Existing queued requests may wait; no scanner motor starts in this state.

When detection settles, the latest result or sanitized completed error replaces
the snapshot. A disconnected source therefore disappears on actual completion.
WIA/TWAIN remain serialized within the existing adapter; this does not publish
partial, still-running enumeration as a finished result.

Revocation immediately disables future service work and saves the disabled
connection. Shutdown waits for actual discovery completion before closing the
native context; a late result is harvested even during draining. The service
lock remains held while draining. No observation timeout, Task cancellation,
automatic process termination or context replacement masquerades as completion.
A genuinely hung driver can therefore keep shutdown draining. Operator recovery
of an actual manufacturer hang remains unqualified; the ordinary UI suggests
checking for a driver dialog and keeping one helper running, not restarting a
worker loop. Saved originals and review/Inventory workflows are unchanged.

## Protocol / packages

Helper/installer **0.3.7** retains native protocol tag `0.3.0-native`.
The site advertises `discoveryProgressReporting` in pulse acknowledgements.
Only after negotiation does the helper send `DISCOVERY_IN_PROGRESS` with a null
retry interval. Older sites receive their supported pulse shape/diagnostics,
with sources withheld during pending detection. This avoids sending an unknown
code or offering Start through a website that cannot gate on pending detection.

The existing nullable diagnostic column is reused; there is no new migration.
Legacy/native pulses preserve explicit diagnostics and a completed empty report
clears them. Owner/auth/revocation/credential fences remain intact.

NAPS2.Sdk/Images.Gdi/Worker.Win32 remain **1.3.0**; the embedded worker is8.3.0.
In the [pinned controller source](https://github.com/cyanfish/naps2/blob/v8.3.0/NAPS2.Sdk/Scan/ScanController.cs),
GetDeviceList awaits completion with CancellationToken.None. GetDevices offers
a token, but the pinned [WIA enumeration](https://github.com/cyanfish/naps2/blob/v8.3.0/NAPS2.Sdk/Scan/Internal/Wia/WiaScanDriver.cs)
and [TWAIN enumeration](https://github.com/cyanfish/naps2/blob/v8.3.0/NAPS2.Sdk/Scan/Internal/Twain/TwainScanDriver.cs)
run their work off-thread without using the enumeration token to establish
native termination. This batch retains GetDeviceList and tracks its completion;
switching to the streaming API would not establish a safe hang-cancellation gate.
No SDK/library/model/license update or raw TWAIN implementation is introduced.
Distribution notices/source/native prerequisites remain in SCANNER_NAPS2_LICENSES.md.

## Evidence, September30,2026

- Old awaited discovery baseline failed with a controlled pending delegate after
  100ms: the service turn could not return while the gate remained held. The
  gate was released for cleanup; no native worker, driver or motor was used.
- Six new mechanical groups pass: one pending operation across repeated polls,
  late result during shutdown/no future work, synchronous blocking off-loop,
  previous choices/late removal and old-site negotiation, sanitized completed
  failures/retry cadence, fast-call settling, and actual NAPS2 adapter close
  fencing/late results. The output groups combine related checks.
- Six existing discovery groups, credential/native transport selftests and five
  Node transport tests pass. They are mechanical evidence, not vendor-hang or
  physical-transfer qualification.
- Eleven focused protocol/outage tests and typecheck/focused lint pass. The
  progress code requires a null retry interval; unknown/unbounded/private
  diagnostics remain rejected.
- Disposable acquisition/shared-import checks pass (37s persisted/46s import),
  including negotiated capability, progress persistence/clearing, older pulse
  preservation and owner/credential denial. Owned fixture/database cleanup pass.
- Final self-contained local-only0.3.7 installer passes all selftests. It is
  staged for the local website; installed0.3.5 stays unchanged/stopped. Its
  manifest source is c0c794f; SHA256
  `2aa5e56c7e2622cb2ed5c9f45d95c533262bec21bf6f4a283bf113154c46a7a3`.
- Cumulative Docker is healthy and source-verified:495inputs, first digestf9fe40a1/image d121c817 before the hint fix. First pending/late/refresh/revocation browser case passes1/1/2.7minutes.
  Initial and later35-second calls stay online beyond the30-second cutoff,
  source/destination persist, Start waits then enables, revocation marks disabled
  immediately and waits for actual controlled completion/exit0. No duplicate
  fake query, session/run or Inventory; owned cleanup passes. Pending/settled
  desktop1366/phone320 inspected without page-wide overflow.
- Layout review found the generic Start hint still said to choose an online
  source while detection was pending. f074af7 reports the real reason beside
  Start. Final image source495/digest6bd68902/imagef225500f is healthy/verified.
  Grouped UI30648 passes3/4: real motor-free sources1.9min, pending case2.6min,
  lost-ACK recovery12.1s. Lost-request case stopped on localhost socket hang-up
  in route.fetch; web remained healthy/no OOM/restart. Retained private trace.
  Scoped unchanged lost-request rerun3407 passes1/1/14.9s including same identity,
  offline recovery/reload, one run/START and photo-input storage independence.
  No socket root cause is claimed. All cases cleaned owned records; remaining
  fixture users0 and helper/native worker processes0. Final pending/settled
  desktop/phone layouts inspected, including accurate Start hint. No feed or
  production connection operated.

The localhost-only discovery fixture uses the real adapter/transport with
managed fake delegates. A 35-second delay represents a controlled eventual
completion, not timing out a native driver. It cannot poll START or acquire an
image. Run with the existing opt-in SDK/DLL environment and
`npm.cmd run ui:test -- tests/ui/scanner-discovery-progress.spec.ts`.

Remaining operator gates: real USB reconnect/vendor-dialog/hung-driver behavior,
physical600-DPI feeding and manufacturer recovery. Public distribution/clean-host,
larger-list UX, recognition accuracy and fi-7160 qualification remain separate.
