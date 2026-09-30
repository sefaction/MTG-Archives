# TWAIN footer investigation

Tracking [#539](https://github.com/sefaction/MTG-Archives/issues/539). This is an
acquisition integrity investigation, separate from recognition #463 and pending
rejected-Start recovery #529. The scanner parent #536 and its stack are merged. This isolated draft is now
based on approved main8aad8e4 (including merged #541); its own merge remains unapproved.

## Original evidence

The operator's five local website scans on September30 used the PS286 Pro's
TWAIN source, requested600 DPI, RGB/simplex,2.6×3.6 inch frame, Start alignment.
All originals already clipped the bottom footer and contained filled edge strips.
Every local spool SHA-256 equals its server-original SHA-256. All five existing
Card scan preparation jobs completed and resized those images without recovering
the missing pixels. No recognition or upload defect is claimed from this evidence.

| Acquisition | Returned pixels | PNG bytes | SDK elapsed | Visible footer |
|---|---:|---:|---:|---|
| Website TWAIN defaults, five cards |1367×2003,1366×1998,1488×2002,1367×1995,1365×2001|6,258,728–6,877,762 (individual manifests retained)|21.305s total|Clipped in all5|
| Fresh WIA600/Start, same requested frame |1560×2031|7,697,907|7.503s|Complete|
| TWAIN requested Native transfer, modern DSM |1367×2000|6,637,454|9.941s|Clipped|
| TWAIN requested Native transfer, old DSM |1366×1997|6,561,359|9.840s|Clipped|

These are dependent scans of the same Sunblade Samurai for diagnosis, not an
independent recognition accuracy sample. Requested modes/frame/DPI are not
proof of the settings accepted by the driver. Native and old-DSM requests alone
did not fix the visible result. WIA is a working comparison, not abandonment
of TWAIN. WIA and modern Native each emitted one undamaged card with no
jam/double/dialog, confirmed by the operator. The old-DSM scan also emitted one
undamaged card normally; the operator then confirmed feeder/transport empty.

## Exact public SDK gap

The pinned NAPS2.Sdk1.3.0 source commit
`8ae3e82203115754e804fe9c14f00f6bd86ee192` sets a TWAIN ImageLayout frame but
does not expose its negotiated frame/result through ScanCaps. Its TwainOptions
offers DSM, transfer mode, progress and WIA inclusion; it does not expose a
toggle for vendor automatic cropping/border detection. KeyValueOptions in this
version is for SANE. `CropToPageSize=false` controls SDK software processing,
not every driver automatic option. The installed driver template has Auto Crop
enabled, but a template is not proof of the live driver's current setting.

Inspect live vendor settings/negotiation next. Do not infer the precise driver
defect from dimensions alone, globally force Native for every TWAIN source, or
automatically feed another card as a retry. Keep any eventual compatibility
behavior below the generic scanner boundary.

## Bounded diagnostic tooling

`scan-diagnostic <request.json> <private-spool-root> <mode>` uses the existing
NAPS2 backend and RunSpool. Modes are `default`, `memory`, `native`,
`native-old-dsm`, and `driver-ui`. Normal website scans keep their existing
settings. There is no automatic retry or second preprocessing path. The command
selects only the requested source and retains each run's mode in its manifest.

SDK logs are explicitly private: they can contain driver names and absolute
paths, are outside the run/export, and are never sent to the website. The
prebuilt SDK worker does not forward all TWAIN-native logging to the host;
the host log is not a complete capability-negotiation trace. Opening driver-ui
requires an operator-confirmed empty feeder/transport, then close the window
without pressing Scan until a separate controlled test is arranged.

The existing saved originals are preserved. The tested website remains on its
stable cumulative image; diagnostics are not a delivered footer fix or an
installed helper update. No production configuration or Inventory changed.

## Restart and profile inspection

The operator restarted the laptop before changing settings. The old settings
inspection has no accessible process handle; its evidence is retained without
claiming successful native completion. A fresh inspection uses the existing
project .NET8 runtime and a new private run identity, after renewed confirmation
that feeder and transport are empty. The global runtime failed before SDK start;
no diagnostic evidence was overwritten or runtime installed.

The operator saved a profile named Cards and a custom page size named Cards,
then confirmed Cards selected and the settings window closed. The same inspection
completed normally with zero images and process exit0. Its preserved events record
SDK enumeration completion; physical exhaustion and negotiated settings remain
unknown. No timeout, replacement context or physical scan was used to close it.

Active profile selection alone does not prove the fixed dimensions, driver
automatic options or settings accepted by a later headless run. The following
two comparisons used separate, freshly confirmed one-card loads.

## Cards-selected headless comparison, September 30

After Cards was selected and the empty-feeder settings inspection completed
normally, the operator freshly loaded the same Sunblade Samurai. A fresh
TWAIN/default600/simplex2.6x3.6 run completed in 13.110s with one retained
1366x1989 PNG (6,443,747 bytes). Its SHA-256 matches its retained manifest.
The footer remains visibly clipped. The operator confirmed exactly one
undamaged card, empty feeder/transport and no jam, double feed or driver dialog.
No automatic retry or Inventory operation occurred.

This result does not establish that the requested frame or saved driver options
were accepted. The pinned SDK ConfigureSource applies its page frame, resolution
and other standard settings for headless runs; UseNativeUI returns before those
settings, leaving their selection to the driver window. Neither path exposes
negotiated vendor automatic cropping through the public SDK.

## Cards driver-window comparison, September 30

After a fresh one-card loading confirmation, the operator reported verifying
Cards, fixed2.6x3.6 inches, simplex600 and disabled Auto Crop/Auto Deskew, pressing
Scan once and closing the window. The same native session completed normally in
23.782s, process exit 0. It retained two 1560x2160 originals (5,430,645 and 5,785,665
bytes); both file hashes match their manifests. Visual inspection shows the
Sunblade Samurai front with a complete footer, plus its card back. Every image
is retained with UNKNOWN SDK side/boundary metadata; visual interpretation does
not replace device side evidence.

This establishes a useful difference between operator-controlled driver-window
and headless acquisition in this comparison. It does not isolate which driver
option or negotiation causes headless clipping. The operator confirmed one undamaged physical card and empty feeder/transport
with no jam or double feed, and is unsure whether Simplex or Duplex was shown.
Treat the actual selected mode as unknown, rather than two physical cards. Native UI bypasses the SDK's standard configuration,
including feeder/duplex selection, so it is not a qualified automatic fallback.
No installed helper, website behavior, recognition or Inventory changed. Keep
this draft open until headless frame/automatic-option negotiation is understood;
do not feed again automatically or discard the extra image.
## Motor-free negotiation leads and completed driver errors

Two private 32-bit probes use the same pinned NAPS2.NTwain1.0.1 dependency but a
separate probe application identity, so their readback is not a trace of the
previous actual SDK scan. They never enable acquisition. No package or installed
helper was changed. The first read-only probe completed normally: border
detection and deskew false, undefined-image-size false, custom size None, both
resolution axes600, feeder enabled and duplex enabled. The reported frame was
approximately2.95,0,5.55,3.6 inches. Automatic length, crop-uses-frame and autosize
were reported unsupported. Its DSM path was the system twain_32.dll despite
PreferNewDSM; do not infer the actual SDK-run DSM from its requested preference.

A second state4-only probe applied the helper-equivalent standard settings.
Every Set returned Success; crop and deskew remained false, duplex read back
false and both resolutions600. Final ImageLayout nevertheless read0,0,8.5,14
inches. This is a negotiation lead, not proof of which setter changed the frame
or of the preceding clipped scan's configuration. Source/session close returned
Success and the process exited0 with no images. The probe's transient driver
settings were changed; it did not reset or feed the scanner.

Two bounded follow-ups to trace the frame after individual settings could not
open the source and exited5 without applying their configurations. The second
recorded OperationError. Both sessions closed normally. The first private trace
has an instrumentation inconsistency: its final event says exit0 because of an
early-return/finally status bug; the external process status is authoritative5.
The later probe corrects that reporting. Preserve both traces unchanged.

One empty-feeder settings inspection through the existing tested SDK also ended
with AlreadyHandledDriverException, ERROR, zero images in850ms and process
exit1. The operator saw no error dialog and confirmed powered/connected. All
owned diagnostics finished; no timeout, forced termination or refeed occurred.
Four pre-existing installed helpers and their four workers remained stable;
none was started, replaced or stopped. Their presence is not a proved cause.

The operator power-cycled with empty feeder/transport and confirmed connected.
One motor-free follow-up recovered source access and completed normally with
zero acquisition/images. In that private state4 trace, the centered custom frame
survived transfer/indicator/feeder settings, then CAP_DUPLEXENABLED=False changed
reported layout to0,0,8.5,14. Subsequent Start and Center custom-frame requests
both returned Success, but the immediate readback remained Legal. Crop/deskew
stayed false, resolution600 and duplex false. All source/session closes succeeded.

This identifies a before-enable state change in the private probe, not a complete
cause of the prior SDK scans. The subsequent default headless600/Center comparison is complete, as recorded
below; native-state readback alone did not predict a complete returned image. Do not claim a
footer fix or consider the driver qualified. No Inventory, production, recognition,
installed helper or local web changes occurred.
## Center-alignment physical comparison, September 30

With a fresh one-card loading/ready confirmation, the unchanged tested helper
completed a TWAIN/default600/simplex2.6x3.6/Center run normally in11.644s,
process exit0. One1365x1996 original (6,576,091 bytes) is retained and its SHA-256
matches its manifest. Visual inspection still shows the clipped Sunblade Samurai
footer. The operator confirms exactly one undamaged card, feeder/transport empty
and no jam, double feed or driver dialog. No automatic refeed occurred.

Center alignment alone did not fix this run. The separate state4 probe is not
an actual SDK scan negotiation trace; inspect inside the pinned SDK worker before
further physical comparisons. Native UI remains a useful full-footer comparison
but not a qualified automatic fallback. No installed helper, recognition,
Inventory, production or local web change occurred. Rejected-Start PR541 was
separately individually approved and merged into main; this draft remains open.

## Private intra-worker tracing preparation, September 30

A private diagnostic copy of the exact pinned SDK source now records state4
capability/frame readback around the existing configuration calls, plus existing
transfer image information. It introduces no additional setters, enabling,
cancellation or retry. Opt-in logging uses CreateNew and is outside run exports.
All original runner operations are mechanically preserved. An initial bad patch
was caught and retained before any hardware use; the corrected build passed.

Five offline cases passed without a scanner context: disabled flag, synthetic
metadata, existing-file preservation, relative-path rejection and logging failure
after enable-start metadata. Cleanup logging cannot suppress original handle
disposal. Private SDK/compiler/source artifacts are ignored local evidence.

The worker targets net462 on existing x86 .NET Framework; the tested host remains
unchanged on existing .NET8. This is a runtime variant, not the bundled worker,
and extra state4 queries can affect timing. Do not treat results as exact original
binary negotiation or claim a footer fix. No runtime or installed helper changed.
A separate IPC-only bootstrap initially failed; its unchanged worker passed a
repeat with startup logging and exited naturally0. Both results are preserved;
no cause is attributed. Neither bootstrap enumerated, opened or enabled a source.

A fresh default600/simplex2.6x3.6/Center request is prepared but not started.
Wait for a new operator loading confirmation before any physical acquisition.
The preceding Center comparison is complete/clipped, not pending. PR541 is merged
and issue529 closed; PR540 remains an independently unapproved diagnostic draft.

## First private intra-worker acquisition attempt: completed error

After a fresh single-card loading confirmation, the private runtime variant ran
once and completed ERROR with zero images in1545ms, external process exit1.
Source opening succeeded. The source initially reported the centered2.6x3.6
frame,600dpi,duplexTrue and crop/deskewFalse. After the original simplex request,
its reported frame became Legal and resolution200. The original custom-frame Set
returnedSuccess but immediate readback stayedLegal. After standard configuration,
readback was600dpi/duplexFalse/frameLegal. Acquisition enabling returnedFailure
instate4; normal unloading returnedstate2. No image-transfer event was recorded.

Every trace/event/run/private SDK/process file is retained. No owned worker or
native context remains and no automatic retry, forced kill or refeed occurred.
Operator physical outcome is pending; ERROR/noimages does not prove no motion
or an empty feeder/transport. Do not start another run from the prior loading
confirmation. This narrows the private worker's configuration evidence but does
not isolate the footer cause or qualify a change to the bundled runtime. The
shipping helper, website, Inventory and recognition behavior remain unchanged.

## Empty-scanner ordering/custom-frame probe

The operator reports that the previous error-run card stayed in the feeder;
movement and dialogs remain unspecified. They then removed it and confirmed empty
feeder/transport, powered/connected. A separate configuration-only probe ended
normally, exit0, no Enable/images, with successful source/session closes.

DPI600 before the frame request did not change Legal layout readback. Selecting
SupportedSizes=None also returnedSuccess without changing Legal. Subsequent
custom-frame requests through DAT_IMAGELAYOUT and ICAP_FRAMES returnedFailure.
ICAP_FRAMES current nevertheless reported the centered2.6x3.6 frame while
DAT_IMAGELAYOUT reportedLegal. These disagreeing driver readbacks do not prove
which area an enabled scan would acquire. No acquisition or automatic refeed.

The failure ConditionCode logged by this private probe was sampled after further
successful reads, so its Success value is not authoritative for the earlier Set.
Preserve that trace and treat the failure condition as UNKNOWN. Future sampling
must capture status immediately before issuing any other source operation.
The [TWAIN specification](https://www.twain.org/wp-content/uploads/2017/03/TWAIN-2.4-Specification.pdf)
describes matching frame reporting between these two interfaces after frame
negotiation; this comparison is a negotiation lead, not an isolated footer cause.
The probe has a separate application identity and is not the shipping worker.

An empty-feeder original tested driver-window inspection is pending to obtain the
exact selected Cards scan mode/page/DPI. Operator instruction is no Scan, no
changes/save, then Exit. Keep the same native context until actual completion.

## Cards profile screenshot resolves the manual-mode uncertainty

The operator-provided DocTwain screenshot shows profileCARDS with ADF(Duplex),
PageSizeCards,6.60x9.14cm (approximately2.6x3.6in),600dpi and24-bitColor.
AutoCrop is off; AutoDeskew is unchecked/disabled; AutoRotate is off.
AutoDensity is on, brightness15 and contrast35. The original screenshot is
retained privately with its hash. The observed duplex selection is consistent with the two
images from the operator-controlled driver-window comparison; it does not prove
the exact mode of every prior scan or isolate headless clipping.

The operator is asked to create/select a separate CardsSimplex profile with
ADF(Simplex), preserving CARDS and the other displayed settings, and Exit without
Scan. Profile save/selection and native-window closure are pending. Keep the live
settings context until actual return, then inspect negotiation without enabling
acquisition before considering any freshly confirmed physical comparison.

## Cards Simplex profile: motor-free continuity improvement

The operator created the requested separate profile and closed the settings window.
That original native inspection session actually completed normally, exit0 and
zero images. No timeout or forced teardown was used.

A fresh minimal configuration-only probe then read duplex disabled/600dpi and the
centered2.6x3.6 frame. Re-requesting simplex preserved the custom frame, as did a
subsequent successful custom ImageLayout.Set; source/session closes succeeded,
exit0, no Enable/images. This differs from the previous duplex-selected profile
where requesting simplex reset the reported layout to Legal. The probe has a
separate application identity and is before acquisition, so it is not a full
shipping-helper configuration trace or proof of preserved footer content.

A fresh one-card comparison using the unchanged tested helper, original SDK and
bundled worker is prepared but not started. Default600/simplex2.6x3.6/Center;
wait for a fresh operator loading confirmation. Retain originals and physical
outcome before claiming the profile or TWAIN acquisition qualified.

## Unchanged-helper simplex-profile acquisition: completed error

After a fresh one-card loading confirmation, the unchanged tested helper with the
original SDK/bundled worker completed ERROR/image0/1691ms, external exit1. Its
process log contains Fatalerror0x80131506 before the safe DeviceException event.
The exact emitting child PID and native cause are unknown; scoped recent Windows
worker-event queries found no matching crash record. All evidence is retained.
The operator confirms the card stayed in the feeder with no movement or dialog.
No owned diagnostic worker remains and no automatic retry, forced stop or refeed
occurred. This attempt does not qualify the footer or resolve #539.

New [#542](https://github.com/sefaction/MTG-Archives/issues/542) tracks the fatal/
zero-image acquisition blocker separately from clipped images. No cause is
attributed to the four pre-existing installed helper/worker pairs or to #511.
A separate read-only loaded-feeder probe closed normally, no setters/Enable/
images, and reports feederLoadedTrue, feederEnabledTrue, simplex,600dpi/custom
frame. This rules out missing detection in that probe, not every acquisition path.
The operator is asked to remove the card and power-cycle empty before readiness
inspection. Do not infer recovery or authorize another feed from the prior load.

## Explicit diagnostic exception detail

The caught acquisition exception now goes to the existing opt-in private SDK log,
including message/inner exception context. Ordinary contexts retain NullLogger;
website journals/exports still use SafeError without driver messages or paths.
A closed or failing private sink cannot suppress the sanitized error event.
Release build and hardware-free discovery/diagnostic qualifications passed;
default, private, closed-private and disk-failing-private cases preserve the
public/private boundary. At the initial qualification checkpoint, no new build was installed or used for physical scanning,
and no SDK/worker/runtime or normal scan setting changed. Exact diagnostics can
improve the next separately confirmed investigation, not fix acquisition itself.

## Restarted scanner: full exception captured, still zero images

The operator confirmed restarting and loading one test card with a clear transport.
A preceding read-only probe completed with successful source/session open and
close, exit0, no setters/Enable/images; it read feederLoadedTrue, simplex600 and
the centered2.6x3.6 frame. It establishes separate-probe source access and card
detection, not working physical acquisition.

One newly confirmed attempt used the separately built private-error-detail helper
from draft head022b5ca, preserving the original SDK and bundled worker hashes.
It actually returned exit1, ERROR, zero images in897ms. The opt-in private log
retained the full AlreadyHandledDriverException stack through TwainScanRunner.Init;
there is no inner exception or specific driver message. The pinned SDK maps
OperationError to this exception during source opening or enabling, so these
stages remain indistinguishable in this host log. That mapping does not establish
that a dialog appeared or isolate the native cause. Unlike the preceding attempt,
this process log does not contain the fatal0x80131506 message; this is not proof
that its underlying cause recovered. The owned diagnostic worker is no longer
running. No automatic retry occurred; the installed helper and Docker are unchanged.

The operator reports the card is still in the tray, ready to go; precise movement/dialog details were not specified. Preserve the request,
manifest, process/SDK logs and empty image set; footer qualification is unavailable.
Both #539 and #542 remain open, and #540 remains a draft without merge approval.
Further scans need a new explicit loading confirmation.
## Motor-free modern-manager source access

The earlier successful read-only probe selected the system twain_32.dll despite
PreferNewDSM. A new private probe explicitly selects the pinned SDK archive's
32-bit modern manager, preserving the prior probe application identity. Its first
attempt failed with DllNotFoundException before the session opened because the
probe omitted the explicit LoadLibrary step used by the SDK. Preserve that source
and trace; it is a probe construction failure, not an acquisition root cause.

The corrected version preloads that same manager successfully, then opens the
session and Plustek source, reads state4 capabilities/layout, and closes both
normally, external exit0/state2. It reports feederLoadedTrue, simplex600, crop/
deskewFalse and the centered2.6x3.6 frame. No setters, Enable or images occurred.
This existing .NET Framework x86 probe remains a different runtime/application
path from the original bundled SDK worker. Successful modern-manager source
access here does not isolate the helper's source-open versus Enable failure.
No installed library or helper changed. The completed failed scan was not retried.

Next inspect the helper's driver-window path only after the operator confirms
removing the card and leaving feeder/transport empty. No physical scan is assumed;
#540 stays a draft and both acquisition issues remain open.
The operator subsequently removed the card and confirmed empty/powered/connected.
One fresh driver-ui inspection using the tested private-logging build is pending;
wait for the exact displayed settings and Exit report, and retain the same native
context until actual completion. No Scan is authorized during this inspection.
## Empty driver-window inspection completed normally

The tested logging helper and original bundled SDK worker opened the driver window
with the feeder/transport explicitly empty. The operator reports no selected
profile, a Custom page size with the discussed card dimensions, ADF front side,
and600dpi, then closed with Exit without Scan. The same native context actually
returned exit0/COMPLETED/zero images/86725ms. This establishes successful driver-
window access in that session, not correct subsequent headless negotiation or
physical acquisition. No native context remains pending. A new headless comparison
is prepared but not started; fresh single-card loading confirmation remains required.
## First complete-footer headless Center comparison

After that driver-window inspection completed and a new single-card load was
explicitly confirmed, the same tested logging helper and unchanged SDK/worker
completed default600/simplex2.6x3.6/Center, exit0, one image in12.611s. The retained
original measures1560x2160 and7,278,638 bytes; its SHA-256 matches the image
manifest. Visual inspection shows the complete Sunblade Samurai footer, including
039/302 C, NEO EN, artist and copyright. The operator confirms exactly one
undamaged card, empty feeder/transport, no jam/double feed/dialog.

This is the first successful complete-footer headless comparison in this sequence,
not a software footer fix or reliable recovery qualification. The normal SDK
capabilities now report feeder/duplex/color/DPI support rather than the preceding
empty/unknown results; this is a useful source-access change, not an isolated cause.
Background edge strips remain. The original, SDK log, process log and manifest are
preserved; SDK side/physical-boundary/exhaustion metadata remains UNKNOWN.

The next separate comparison uses the website's usual Start alignment instead of
Center, keeping the same requested600/simplex/card size and original SDK/worker.
Wait for a fresh single-card powered/connected/clear-transport confirmation. Do not
retry automatically or close #539/#542 based on this one successful Center scan.
## Website Start alignment comparison: retained blank original

After a separate fresh loading confirmation, default600/simplex2.6x3.6/Start
completed exit0 with one1560x2160 PNG in10.504s. The retained2,312-byte original
matches its manifest hash and is visibly blank white; card/footer pixels are
absent. An SDK completed result and requested dimensions do not make this a valid
card image. Physical feed/jam/dialog outcome is awaiting the operator.

The successful Center scan and this failed-content Start comparison used separate
confirmed loads of the same card and the same helper/SDK/worker. This establishes
an alignment-sensitive result in these runs, not reliable general acquisition or
an isolated explanation for every earlier clipped scan/initialization failure.
The pinned SDK uses zero horizontal offset for the helper's Start mapping and
half the reported source width minus requested width for Center. Keep returned
content and negotiated settings distinct; no actual worker-frame trace was added.

The website previously hard-coded Start for new batches and offered no alignment
control. This draft now adds Card position under Scan settings, defaults new
batches to Center (matching the generic CLI request default), and retains explicit
saved Start/Center/End choices in recovery/continuation. The operator can select
an edge position where appropriate for feeder guides. No device-specific transfer
mode, retry, SDK/runtime, or installed-helper change is introduced. Typecheck
passed using the cumulative review dependencies; Docker/browser checks pending.
## Website alignment control: local acceptance

Typecheck and the cumulative Linux production build/client-manifest checks passed.
The local web container is healthy, login HTTP200, and verify:local-image confirms
all496 application-source hashes and digestf444c168b15b97d373f072c0e161b5954bdb69a5987adbd3f04f4330287c2250.
Image d83f1875e5c60a38806dc40ea3921c08beb05aff09b045a7caa30e6ab1189dd5
was built from the authoritative cumulative review worktree, not primary.

The owned browser fixture passed defaultCenter, all three explicit positions,
actual queued server/helper-poll payloads, persisted settings and continuation.
Desktop1366 and phone320 screenshots were inspected; no horizontal overflow.
All fixture users, agents and acquisition sessions are cleaned to zero. No native
helper or motor was run by this browser check; it does not qualify physical startup
reliability. Existing explicit choices remain intact, including Start in old setups.
Review Scan settings > Card position > Center before using such a saved setup.
Only the local web container changed; recognition workers, installed helper and
production are unchanged. No Inventory action occurred in the physical diagnostics.