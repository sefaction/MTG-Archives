# Scanner discovery recovery

PR #535 depends on individually unapproved #528 and its scanner stack. It does
not include the independent review/recognition changes that are present in the
cumulative local Docker build. No production update or merge is authorized.

## Behavior

- Discover WIA and TWAIN independently. A completed error from one source does
  not discard devices from the other source or skip the helper heartbeat.
- Refresh WIA after 30 seconds. Cache successful TWAIN enumeration for this
  backend's lifetime, preserving the existing worker-lifetime fix. Driver/source
  installation changes may require reconnecting the helper.
- Retry completed source failures after 30, 60, 120, 240, then at most 300 seconds.
  Keep one worker initialization per backend context. If initialization fails,
  do not initialize or query TWAIN again in that context; report restart needed.
- A WIA-only acquisition does not initialize or query TWAIN. Existing scanner
  preparation, settings, original spooling and delivery remain authoritative.
- Keep diagnostics bounded and generic: source, recovery code and retry interval.
  No driver exception text, credentials or local paths enter the normal UI.
- Show online connection separately from source availability. Available sources
  remain usable; no-source Start stays disabled. Guidance explains automatic
  retry, USB/power/driver checks or helper reconnection after finishing a scan.
  Saved scans remain intact.

The optional diagnostics use a nullable ScannerAgent JSON column (migration
20260930090000_scanner_discovery_issues). An explicit empty report clears prior
issues; omitted diagnostics preserve them for native keepalives/older helpers.
The helper sends the new field only after an acknowledgement advertises support.
An older website receives the original pulse shape. The native protocol tag
remains `0.3.0-native`; installer/helper version becomes **0.3.6**.

## Local evidence, September 30, 2026

| Check | Evidence |
|---|---|
| Baseline | Old TWAIN-first adapter threw before returning the available fake WIA source; expected failure retained privately. No native call or motor. |
| Native discovery selftest | Six groups pass: partial/inverse/all-source failures, bounded backoff and recovery, WIA removal/reconnect, successful TWAIN caching, once-only failed setup, WIA-only isolation, generic refresh failure/legacy reporting/redaction, and pending-call close fencing. |
| Existing helper checks | Credential and native transport selftests and Node transport checks pass. No SDK/package/lock upgrade. |
| Web protocol | Eleven focused protocol/outage tests pass; bounded optional diagnostics, legacy acceptance and existing denial/service-error distinctions. Typecheck/focused lint pass. |
| Database | Disposable acquisition/shared-import integrity passes. Owned status persists/clears; omitted snapshots persist; wrong credentials cannot clear diagnostics. Existing ownership/revocation fences and scoped cleanup pass. |
| Fault UI | Real Windows helper/localhost transport, fake adapter below ScannerBackend: partial/all/setup cases pass in 59.3 seconds. Heartbeat continues, correct recovery guidance, usable-source Start enabled without clicking it, no-source Start disabled, revocation exits, zero sessions/runs/Inventory. Desktop1366 and phone320 inspected; no page-wide overflow. |
| Initial UI failure | The test's own storage layout omitted required sections:[] and caused strict layout validation to throw. Corrected only the fixture; retained original log/trace privately. Not attributed to scanner discovery. |
| Real source UI | New owned localhost pairing using framework helper0.3.6 passed in1.9minutes. Website listed two WIA sources and Plustek PS286 Pro-TWAIN. Three refresh intervals retained at most one owned worker; revocation ended helper/worker and further reporting was denied. Sources/layout/600DPI readiness checked without START; owned records removed, zero Inventory. |
| Installer | Self-contained local-only 0.3.6 installer and all selftests pass; staged EXE digest agrees with its manifest. Installed0.3.5 remains unchanged/stopped. No public package or production connection operated. |

Fault UI command (local-only): set `MTG_LOCAL_PILOT_TEST=1`, the local .NET SDK
path in `MTG_SCANNER_DOTNET` and new framework DLL in `MTG_SCANNER_HELPER_DLL`,
then run `npm.cmd run ui:test -- tests/ui/scanner-discovery-recovery.spec.ts`.
The fixture server requires explicit localhost guards, cannot poll START and
never initializes a real native worker. It uses owned disposable account data.

## Limits

**Completed failure isolation is not hung-driver recovery.** A driver call that
does not complete still delays the awaited discovery/heartbeat. Issue #534
separately tracks truthful heartbeat while a single discovery remains in flight.
No timeout proves completion; no premature context disposal or replacement
worker is added. The mechanical pending test verifies retaining the eventual
result and refusing early Close, not real driver cancellation.

Pinned packages remain NAPS2.Sdk/Images.Gdi/Worker.Win321.3.0. The embedded worker
identifies NAPS2 8.3.0. In the [pinned ScanController source](https://github.com/cyanfish/naps2/blob/v8.3.0/NAPS2.Sdk/Scan/ScanController.cs),
GetDeviceList uses CancellationToken.None; GetDevices exposes a token. Neither
API's token alone establishes native completion. See SCANNER_NAPS2_LICENSES.md
for component/source/notices and clean-host distribution gates.

Real USB unplug/replug, vendor proxy behavior, real 600-DPI transport and physical
feeding still require operator evidence. Real discovery is motor-free but does
not qualify scan transfer, stop-at-N or duplex. Recognition accuracy, fi-7160
qualification, public distribution and Inventory remain separate concerns.
