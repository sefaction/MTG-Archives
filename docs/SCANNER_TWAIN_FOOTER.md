# TWAIN footer investigation

Tracking [#539](https://github.com/sefaction/MTG-Archives/issues/539). This is an
acquisition integrity investigation, separate from recognition #463 and pending
rejected-Start recovery #529. The scanner parent #536 and its stack are merged. This isolated draft is now
based on approved main0d1d18a; its own merge remains unapproved.

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
option or negotiation causes headless clipping. The reported simplex setting
and two returned sides disagree; scan-mode recollection and post-feed physical
observations are pending. Native UI bypasses the SDK's standard configuration,
including feeder/duplex selection, so it is not a qualified automatic fallback.
No installed helper, website behavior, recognition or Inventory changed. Keep
this draft open until headless frame/automatic-option negotiation is understood;
do not feed again automatically or discard the extra image.
