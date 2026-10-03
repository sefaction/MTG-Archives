# Windows scanner qualification agent

Local hardware spike for [#473](https://github.com/sefaction/MTG-Archives/issues/473), related to #312. **Not production-qualified.** See [qualification report](../../docs/SCANNER_NAPS2_QUALIFICATION.md). No changes to recognition, review or Inventory code.

## Run

Requires Windows, .NET 8 SDK/Desktop runtime, an installed manufacturer driver and Node 22 for the optional transport checks. Restore pinned NuGet packages; do not use the installed NAPS2 GUI/console executable as the backend.

The optional [local source-build setup](../../docs/SCANNER_SOURCE_INSTALL.md)
validates and copies the site-connected helper under appdata without starting
the scanner. Prebuilt distribution remains subject to the separate license gate.

```powershell
dotnet restore tools/scanner-agent/ScannerAgent.csproj --locked-mode
dotnet build tools/scanner-agent/ScannerAgent.csproj --no-restore -c Release
$agent = 'tools/scanner-agent/bin/Release/net8.0-windows/Mtg.ScannerAgent.dll'
dotnet $agent list
dotnet $agent caps 'Twain:Plustek PS286 Pro-TWAIN'
```

Select an exact enumerated identity. Enumeration does not imply qualification. WIA and TWAIN sources remain distinct generic routes. The site-connected helper also offers an explicit `CountedTwain:PaperStream IP fi-7160` profile when that exact TWAIN source is detected and the companion is bundled. This route uses the separate x86 .NET Framework companion, the pinned NTwain 1.0.1 library and legacy DSM, with the tested PaperStream 3.40.2.1815/protocol 2.4 profile. It reads back a finite XFERCOUNT and AUTOSCAN=false before a single Enable, retains every image, and never falls back to a generic drain. Its 600 DPI centered current 2.7 x 3.6 inch frame is fixed. See [counted-feed qualification](../../docs/FI7160_COUNTED_FEED.md) for the one/two-of-three physical evidence and larger-count limits.

Helper 0.4.0 includes this companion in source copies and self-contained installers. `native-selftest` exercises the real process channel using an explicit fixture mode that constructs no TWAIN session, including early empty, retained overtransfer and restoration failure. Build output and installed copies verify the locked companion dependency. The generic diagnostic `scan` command remains the NAPS2 route; counted website segments use `ScannerNativeRunner` after its durable claim. Recovery of an existing segment only delivers retained originals. An explicit website refill creates a different segment/journal within the same acquisition session.

For the separately reviewed site-connected helper, `serve CONNECTION-ID`
checks retained originals without starting a scanner. Every five minutes while
online it asks the authenticated site which exact photo receipts have passed
the ordinary committed-photo seven-day purge. It checks its local manifest,
receipt, bytes and digest again before removing only the matching PNG. Pending,
uncommitted, unreconciled, changed or unavailable originals remain in private
LocalAppData. Run bindings and journals remain to prevent an old command from
feeding again. No local age-only deletion is used. The site-connected prototype
and its production gates are described in
[Native scanner batch delivery](../../docs/SCANNER_NATIVE_START.md).

Create a private request outside tracked source, then scan only when the operator has confirmed feeder contents and transport safety:

```json
{
  "runId": "REPLACE-WITH-A-NEW-UUID",
  "deviceId": "REPLACE-WITH-ENUMERATED-ID",
  "dpi": 300,
  "widthInches": 2.6,
  "heightInches": 3.6,
  "duplex": false,
  "horizontalPlacement": "Start",
  "sessionPhysicalTarget": 1,
  "imageStopBudget": null,
  "allowInterruptingStop": false
}
```

```powershell
dotnet $agent scan .local-data/request.json .local-data/scanner-spool
node tools/scanner-agent/transport.mjs audit .local-data/scanner-spool/RUN-UUID
node --test tools/scanner-agent/transport.test.mjs
```

`sessionPhysicalTarget` is an instruction/evidence field, not a backend capacity calculation. `imageStopBudget` is a **diagnostic image-count trigger**, never proof of physical items completed. Until device boundaries and safe stopping are qualified it cannot enforce a business physical target.

`Start` placement means zero horizontal frame offset; `Center` and `End` request offsets. Driver interpretation must be measured. These are generic settings, not vendor code. RGB, UI suppression and no software deskew/crop/blank removal are requested. Vendor automatic processing and negotiated settings are not reliably queryable through this SDK.

## Stop and cancel

For a controlled local investigation only, `scan-diagnostic <request.json>
<private-spool-root> default|memory|native|native-old-dsm|driver-ui` keeps the
same backend/spool and saves an explicit private SDK log. Normal website runs
do not inherit these modes. Every physical attempt needs a fresh operator
loading confirmation and run UUID; no mode automatically retries. Use an empty
feeder/transport for driver-ui inspection and close without pressing Scan.
Caught acquisition exceptions, including full message/inner context, are retained
in that opt-in log. A closed or failing private log does not suppress the safe
error journal. Default website diagnostics still omit messages and paths.
Logs may contain native paths/device details and must not be published.
See [TWAIN footer investigation](../../docs/SCANNER_TWAIN_FOOTER.md).

The tested SDK has no distinct public graceful feeder-stop method. **PS286 WIA cancellation after image 1 emitted two cards and left a third partly transported.** No damaged cards were reported after manual clearance, but one emitted card had no returned image.

- `stop.request` inside the active run directory calls `RequestStop`. By default it records unsupported graceful stop and allows the current feeder run to drain. It does **not** promise a capacity limit.
- `cancel.request` or Ctrl+C calls native cancellation. It can strand paper or lose a partial transfer. Use only a controlled diagnostic with an observing operator.
- `allowInterruptingStop: true` explicitly enables the failed cancellation-based stop experiment. It is default off, not a recommended profile. Further interrupting PS286 tests were suspended after the observed transport failure.
- Never kill/delete a spool merely because the target was reached. After an interruption, compare physical output/feeder/transport with all received and partial files before intake.

Each scan command creates a fresh SDK context and closes it afterward. The x64 agent uses the SDK's x86 worker for TWAIN. It is a direct library integration; internal NAPS2 worker processes are the SDK's ABI/message-loop isolation, not shell invocation of NAPS2 CLI. No installer, service, browser listener or updater is introduced.

## Private spool and diagnostics protocol v1

`run.json` contains immutable requested configuration, device/source/backend versions and reported capabilities. `events.jsonl` has ordered timestamps and status evidence. Each complete PNG has a stable artifact UUID, sequence, SHA-256, bytes and measured dimensions in its adjacent JSON manifest. Originals receive no card crop, OCR or identity processing. The existing server performs those tasks.

Images are flushed before manifests/events. A crash can leave an unpublished `.pending.png` or a PNG without a manifest: audit exposes this and refuses automatic delivery. Native partial buffers not returned by the SDK cannot be recovered from this spool; physical reconciliation remains required. Completed/error/interrupted runs never automatically rescan on restart. A reused run UUID is rejected, including after a crash. Disk/encoder errors end acquisition explicitly and preserve already published files.

Default diagnostics contain no image bytes, absolute image paths, credentials, device serial number or exception messages. Requested settings and measured image dimensions are separate; actual DPI/frame/driver settings remain unknown unless independently measured. Empty-feeder SDK exceptions emit `SourceExhausted`; a normal return alone retains UNKNOWN. `AcquisitionCompleted` means native operation ended, not a fulfilled physical target or committed Inventory.

## Existing intake qualification

`transport.mjs` uses the existing same-origin authenticated endpoints at **local Docker only**, `http://127.0.0.1:13001`. It is a qualification client, not production agent pairing/authentication. A private plan must explicitly identify operator-reconciled **one front per physical card**:

```json
{
  "baseUrl": "http://127.0.0.1:13001",
  "sessionId": "EXISTING-SESSION-UUID",
  "operatorReconciledPhysicalFronts": true,
  "physicalFronts": ["ARTIFACT-UUID"]
}
```

Supply the user's existing session cookie through private `MTG_SCANNER_COOKIE` environment state, never command-line arguments or tracked files. The fixture verifier obtains its own temporary user cookie without printing it.

`node tools/scanner-agent/transport.mjs instruction SESSION-UUID` reads the existing session's remaining admission budget and revision. It passes through `availableSlots` (including unlimited/null) and refuses a full/stale/inactive session; it never queries Inventory or calculates capacity itself. The returned instruction explicitly says automatic physical enforcement is unsupported and leaves the diagnostic image trigger unset. Recheck/reserve through the server at delivery because a read-only budget is not a reservation or guarantee against concurrent changes.

1. Audit local hashes/journal, reject incomplete runs.
2. Bind a run to one existing session and explicit artifact mapping before HTTP mutation.
3. Reserve through `/api/acquisition/{sessionId}` using the stable artifact UUID as request key. Server decides ownership, destination and remaining capacity.
4. POST original bytes through the existing `/photos` endpoint with stable upload key, slot and generation. Lost acknowledgments replay the same identities.
5. Persist the server's photo/digest acknowledgment beside the spool. Unmapped backs/overscan remain retained. Capacity rejection never deletes them or automatically allocates another location/session.
6. Existing photo preparation, recognition, review and explicit Inventory commit remain authoritative.

The current endpoint is a single-front photo provider. This spike deliberately requires operator reconciliation; **it does not disguise raw duplex transfers as phone cards**. Device/run metadata stays in the private spool linked by the server receipt. Production generic artifact metadata transport, uncertain physical-item reconciliation and agent pairing remain acceptance gaps; no scanner-only database exists.

For repeatable integration against the running cumulative app, use a private array of `{label,directory,artifactId}` for independently observed single-front runs:

```powershell
$env:MTG_LOCAL_PILOT_TEST='1'
node tools/scanner-agent/verify-pipeline.mjs .local-data/samples.json .local-data/pipeline-evidence.json
```

The verifier creates a disposable owner and capacity-one section, copies the transport fixture privately for replayable tests, uploads/replays, waits for existing preparation/recognition, visits review, verifies capacity refusal and zero Inventory writes, and removes only its owned server fixture. Scan originals and local qualification evidence remain private. It tests the running app; document its actual source/PR composition rather than claiming the scanner branch contains unmerged recognition work.
