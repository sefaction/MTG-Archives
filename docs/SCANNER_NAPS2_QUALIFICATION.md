# Generic Windows scanner / NAPS2 qualification

Status: **bounded local qualification complete; not production-qualified**. September 28, 2026. Tracking [#473](https://github.com/sefaction/MTG-Archives/issues/473), related [#312](https://github.com/sefaction/MTG-Archives/issues/312). Operator used expendable cards. Sanitized run measurements and separately attributed operator observations are in [qualification-results.json](../tools/scanner-agent/qualification-results.json).

## 1. Live base, branch and PR context

`feat/windows-scanner-backend`, [PR #474](https://github.com/sefaction/MTG-Archives/pull/474), starts at merged main `fc7b3621f4802e2bc17147d8be74afe58572729b` (#467). Implementation/evidence commit `5240c2e`. Live source, issue #463, source/worker/review/capacity/commit code, verification tools and Foundry workflow were read before implementation. No recognition PR is a code dependency.

Independent recognition work remains: #470 tight-scanner footer preservation -> draft #471 full-catalog evaluation -> #472 Scryfall reconciliation. Uncommitted printing-verification work remains untouched in its own worktree. The existing cumulative local Docker app includes #470-#472; its web image is `5b428594690d1aaa8d29c9dc3298e641961e048f42965a8f8dec6e7f28e44dd1`. Scanner pipeline tests used that running build, not an assertion that unmerged recognition is on main. No production change, deployment or merge.

## 2. Files changed

- `tools/scanner-agent/ScannerBackend.cs`: generic device, capability, run and artifact contract.
- `Naps2Backend.cs`: direct SDK adapter and lifecycle, explicit stop/cancel limitations.
- `RunSpool.cs`, `Program.cs`: private durable originals, ordered diagnostics and CLI agent.
- `ScannerAgent.csproj`, `packages.lock.json`: exact resolved packages/hashes.
- `transport.mjs`, `transport.test.mjs`: audited/retry-safe local existing-endpoint intake after physical reconciliation.
- `verify-pipeline.mjs`: disposable local Docker integration check, no Inventory commit.
- `README.md`, this report, license findings and machine-readable qualification evidence.
- `.gitignore`, `.github/workflows/scanner.yml`, `docs/WORK_CHECKPOINT.md`.

No application schema, recognition algorithm, review UI, capacity rule, Inventory commit, Docker/Unraid configuration or existing recognition fixture changed.

## 3. Generic scanner boundary

Implemented `IScannerBackend.ListDevices/GetCapabilities/Prepare/Start/RequestStop/Cancel/Close`. No SDK types cross the interface. Enumerated identities include their source type, so WIA and TWAIN do not collide. Capability states distinguish reported support, reported lack of support, unknown and not exposed. Support status remains `GenericUnqualified`; enumeration is not certification.

Run diagnostics report start, complete images, stop/cancel requests, explicit empty-feeder status when the SDK supplies it, completion and safe error types/status codes. Physical-boundary and side values remain UNKNOWN because this SDK does not supply reliable evidence. No synthetic physical-boundary or side event is emitted merely because a page arrives. Caller-owned physical target is separate from a diagnostic image-count stop budget.

PNG transfer encoding is lossless with SDK `MaxQuality`; no second image preprocessing path was added. Software cropping, stretching, deskew and blank-page exclusion are off. Requested native frame is distinct from actual image dimensions. Vendor automatic options are not reliably controlled by the public API.

`RequestStop` originally used SDK cancellation for the controlled Q8 experiment. That physically overscanned and stranded a card. The delivered implementation defaults to explicitly unsupported graceful stop and drains the feeder instead. `Cancel` remains a distinct explicit operation; using cancellation for the diagnostic budget requires `allowInterruptingStop=true`. Neither path is advertised as exact physical stopping. All complete returned images are drained/persisted, and partial/unmanifested files require reconciliation.

## 4. Exact packages, runtime and licensing

Direct packages: **NAPS2.Sdk 1.3.0**, **NAPS2.Images.Gdi 1.3.0**, **NAPS2.Sdk.Worker.Win32 1.3.0**. SDK assembly reports **8.3.0.0**. NuGet package source commit: `8ae3e82203115754e804fe9c14f00f6bd86ee192`; source inspection was corrected from moving master to this exact SDKREL commit. Lock file records all transitive versions/content hashes.

Local environment: Windows build 22631, x64 host, private .NET SDK 8.0.425 / runtime 8.0.31. SDK's prebuilt x86 worker handles 32-bit TWAIN without changing the host architecture. WIA runs through the same SDK adapter. No NAPS2 GUI or console invocation is used. Existing manufacturer drivers remain installed separately. TWAIN source reports `Plustek PS286 Pro-TWAIN`, manufacturer `Plustek Inc.`; observed driver file version `1, 0, 5, 23275`. SDK 1.3.0 does not expose a protocol-version field (moving upstream source does; it was not relied upon).

The SDK/image/worker components carry **LGPL-2.1-or-later**, independently checked in the actual package license files. NTwain and WIA wrappers are MIT; other dependency licenses differ. See [package/license findings](SCANNER_NAPS2_LICENSES.md). Final binary redistribution is **not cleared**: preserve notices and applicable corresponding-source/relink/replacement obligations, qualify the embedded self-contained worker and DSM, and resolve remaining exact old dependency provenance. A local build/test does not establish a redistributable installer. No native/model binaries are committed.

Primary references: [SDK overview](https://www.naps2.com/sdk/doc/api/), [NuGet package](https://www.nuget.org/packages/NAPS2.Sdk/1.3.0), [exact SDK source](https://github.com/cyanfish/naps2/tree/8ae3e82203115754e804fe9c14f00f6bd86ee192).

## 5. PS286 qualification matrix

| Test | Status | Observed evidence / limitation |
|---|---|---|
| Q1 discovery | PASS | Direct SDK enumerated `Plustek PS286 Pro-TWAIN`; reported feeder, duplex, RGB and DPI choices. WIA source `A4 ADF2 Scanner(K7B)` also enumerated. Other enumerated devices were not exercised. |
| Q2 single card | FAIL TWAIN; PASS WIA transfer | TWAIN returned one real image with footer/edges clipped or filled. WIA returned one useful original with footer. Operator observed one card/no marks/jams/dialogs. No recognition result is used to define acquisition success. |
| Q3 ten independent singles | PASS | Ten fresh-process, fixed-profile WIA single-card runs: one image and one ordered image event each, 3.195-3.264s per run. Operator confirmed one undamaged card/no problems after every run. No agent worker left afterward. No claim of a 100-run virtual-source gate. |
| Q4 feeder 5 then 10 | PASS, small sample | Five images in 6.411s and ten in 10.335s. Operator confirmed exact physical counts/order, empty feeder, no doubles/jams/marks. No SDK physical counter. |
| Q5 existing pipeline | PASS, bounded local slice | Three originals (300/600 centered and 300 zero-offset) through existing HTTP intake, prepare, recognition and review; same photo on replay; server target/capacity-one section enforced; zero Inventory rows. Metadata linkage remains local spool/receipt; production agent transport is not complete. |
| Q6 DPI | PASS measurement; accuracy UNCERTAIN | Same Sunblade Samurai at 300/600. Both proposed NEO39 first, review required. Two dependent scans are not an independent benchmark. |
| Q7 duplex | UNCERTAIN | One loaded card produced front then back visually, two images in 3.260s; one physical undamaged output confirmed. No side IDs or physical boundaries. Never generalize automatic consecutive pairing from this sample. |
| Q8 stop at N | FAIL | Load5/target1: one saved image, two fully emitted cards, third partly fed. Targets2 and5 NOT TESTED after this unsafe stop observation. |
| Q9 short source | PASS observed short count/empty probe; UNCERTAIN natural-end reason | Load5/target10 after recovery produced five images in6.379s; operator confirmed five out, empty feeder/no problems. SDK returned normally with no explicit exhaustion reason. A separate operator-confirmed empty-feeder run returned zero images in0.386s and explicit DeviceFeederEmptyException/SourceExhausted. Neither run fulfilled target10. |
| Q10 cancel/recovery | FAIL safe mid-run stop; PASS manual-clear recovery | Q8 used the SDK cancellation mechanism. One image retained, additional physical movements not represented; manual clearance required. After operator clearance/no damage, a new independent five-card scan succeeded. No claim of unattended jam recovery. |

Statuses intentionally describe the tested source/configuration, not every TWAIN scanner. Graceful stop, side metadata, physical boundaries and device counters are **NOT SUPPORTED through the evaluated public boundary**; the device itself may have lower-level capabilities not exposed here. Exact frame negotiation, multifeed distinctions and driver-native detailed state remain uncertain/not exposed.

## 6. 300 versus 600 DPI evidence

Same physical **Sunblade Samurai, NEO 039/302, English**, centered horizontal request, simplex, requested2.6x3.6in, RGB; automatic software transforms disabled:

| Requested DPI | Actual pixels | PNG bytes | SDK run elapsed | Existing recognition |
|---|---:|---:|---:|---|
| 300 | 1665x1010 | 1,870,038 | 3.278s | Name read; NEO39 first of3 printing proposals; review required |
| 600 | 3330x2046 | 7,580,129 | 7.609s | Same first proposal/review requirement |

Both reached `photo-canonical-v1` and `photo-recognition-v1` COMPLETE. The cumulative #472 catalog stage was CHECKING at the observation point; this is raw recognition evidence, not final reconciled catalog acceptance. Review screenshot showed name read but set/collector not read. No recognition code was changed. Existing prep downsizes for the recognition worker, so greater scanner DPI need not produce more OCR detail. Raw files remain available for the existing recognition corpus; these repeats must remain grouped.

The original TWAIN attempt produced683x1001/1,621,603bytes/6.755s with clipped/filled edges/footer. Later WIA zero-offset (`Start`, corresponding to saved profile's NAPS2 `Right`) request produced780x1011/1,844,261bytes/3.249s and retained footer. This removes the excessive width; variable returned height still differs from the requested1080px. Requested settings are not claimed as negotiated settings.

## 7. Duplex findings

One-card WIA: visible Sunblade Samurai front followed by standard Magic back. All original transfers retained separately. SDK page index is an image sequence, not a sheet counter. No reliable front/back identifier or boundary is available at this interface. Multi-card duplex order/pairing reliability is NOT TESTED; keep both sides unassigned until operator reconciliation or a qualified source exposes stronger evidence.

## 8. Stop-at-N evidence

Run `5434407f-8e47-481b-9cc2-f407999ae1d4`: loaded5, diagnostic image trigger1, target1; image saved then `CancellationToken.Cancel`.1 image returned, elapsed3.451s. Operator:2 cards fully through and a third sticking out of feeder. Thus at least1 fully emitted overscan, N+1 entered transport, another partially transported item; exact remaining feeder count was not separately stated. Physical item count is unknown to software. No complete returned artifact was dropped, but the SDK never delivered an image for at least one emitted card. Native operation returned; transport was not clear. This is **not exact stopping**, and cancellation is insufficient even for safe unattended best-effort physical reconciliation.

Further interrupting cases (load5/target2 and load10/target5) were suspended rather than repeatedly stranding cards. The exact gap to resolve is a device/driver-supported stop-feeding-and-drain mechanism plus physical/side evidence, or a workflow explicitly restricted to operator-loaded batches. No raw TWAIN replacement was written on speculation.

The revised default stop branch records unsupported graceful stopping without cancelling the native run. Its drain-on-stop behavior has **not been physically requalified**; the natural-drain batches above predate that branch. It is not a capacity guarantee. All unreturned native images and physical overscan require operator reconciliation.

## 9. Physical feeding issues

Operator reported no damage, doubles, ordinary-run jams or order changes in the completed natural-drain samples. Interrupting cancellation stranded the third card; manual normal jam-release/clearance was requested and the operator reported no cards damaged. This small expendable-card sample does not qualify valuable cards, long-term surface wear, multifeed rates or the fi-7160.

## 10. Existing acquisition integration

See [agent/transport instructions](../tools/scanner-agent/README.md). Private spool holds scanner evidence and original bytes. Operator explicitly maps physical fronts into an existing session; stable artifact UUIDs become reservation/upload request keys. Existing server owns owner/location/section, reservations, quotas and physical candidate/Inventory authority. Same `/photos` path creates existing durable photo/artifact/jobs; same review and commit UI. No alternate scanner recognition route, schema or review database.

Production gap: source-neutral artifact metadata and unresolved physical/duplex evidence are not yet uploaded as an automated scanner provider. Current scanner metadata is durable in the local run manifest and linked server receipt. The local qualification client refuses production URLs and never selects Inventory ownership or calculates destination capacity. Overscan/unmapped backs remain in spool and cannot be silently admitted as extra physical copies.

The server's existing availableSlots/revision becomes the agent's target instruction (null remains unlimited). It is a read-only budget, not a reservation or exact scanner stop guarantee; existing reservation/upload endpoints recheck admission. Five transport tests cover retry after lost acknowledgments, binding conflicts, overscan retention, capacity refusal, corrupted/interrupted spool rejection, local-only intake, physical-front reconciliation and finite/unlimited/full server instructions. Locked restore, Release build and the three-sample local Docker pipeline check passed. Full build/transport checks run in Windows CI; hosted CI does not exercise hardware.

## 11. Scanner-specific logic

None in application/domain/recognition code. Backend maps generic source/settings to SDK options. Observed PS286 source identities and requested settings exist in qualification evidence; standard horizontal alignment was adjusted based on the existing saved NAPS2 profile. No `if Plustek` or `if Fujitsu` behavior. No `KnownWorking` profile is promoted while stopping and full qualification remain unresolved.

## 12. What transfers unchanged to fi-7160

Generic contract, run/artifact identity, capabilities/unknown states, private spool, hash/journal audit, retry/ack semantics, diagnostic structure, operator-reconciled existing ingestion and processing/review/commit path. Production agent authentication/uncertain-item reconciliation remains a generic unfinished feature, not work to encode in a future scanner-specific branch.

## 13. What must be requalified on fi-7160

PaperStream/TWAIN driver and bitness, real capability negotiation, frame/DPI/color, UI suppression, card feed safety and marks, doubles/multifeed reporting, front/back order and physical boundaries, throughput, source exhaustion, stop-feed/drain/N+1 behavior, cancellation/error recovery. No fi-7160 hardware behavior is asserted.

## 14. Promotion decision

Direct NAPS2 integration is technically viable for image acquisition: real hardware enumeration, transfers, batches, lifecycle and existing pipeline delivery are observed. WIA is the useful PS286 path so far; TWAIN image integrity and SDK stop/evidence limitations block production promotion. Finish bounded evidence and determine whether SDK extension/configuration or a narrow lower-level facility can supply the exact missing behavior before considering a replacement backend. Distribution qualification and production agent/session transport also remain incomplete.

**Recommendation: continue the spike because specific evidence is still missing.**
