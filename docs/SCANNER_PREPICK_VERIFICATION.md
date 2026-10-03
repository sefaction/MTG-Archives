# Motor-free Pre-Pick verification

Physical counted feeding remains suspended after ten images were saved while an
eleventh card partly entered the transport ([issue 602](https://github.com/sefaction/MTG-Archives/issues/602)).
The ordinary helper 0.4.1 safety block remains in place. This diagnostic adds no
feed/start command and cannot qualify a physical boundary by itself.

## Known baseline

The operator read panel Menu 19 Pre-Pick = Yes and driver Pre-Pick = On. After an
explicitly authorized settings-only change, the operator reports saving Off for
profile `004: Cards`. A settings-only reopen selected that profile; the explicit
visual Off readback is still outstanding. Both inspections returned to state 4,
closed source/DSM successfully and made zero acquisition Enable calls.

The [official operator guide, page 188](https://origin.pfultd.com/downloads/IMAGE/manual/fi-7x8060/P3PC-4292-05ENZ0.pdf)
and installed PaperStream IP help `TWAIN/en/ip_help/topic/recovery_prepick.html`
give driver Pre-Pick priority over scanner settings. Pre-Pick advances a document
to its next scanning position; it is separate from XFERCOUNT and AUTOSCAN.
The initial setting is a candidate explanation, not a proven cause of the failed
trial.

The authorized On-to-Off change altered only vendor capability `0x80FD`, UInt16
1 to 0, in the inspector snapshots. It remained 0 on reopening. This correlation
does not establish an official vendor capability mapping. No code SETs that
capability, and its value alone is not accepted as effective Pre-Pick readback.
Named profile persistence also does not establish another application's settings.

## Worker profile inspector

`tools/scanner-twain-count/ProfileSettingsInspect.cs` is an x86 settings-only
program. It loads an explicitly supplied known `Mtg.CountedTwain.exe` assembly's
metadata to create the same TWAIN identity as the current native worker; it does
not execute the worker or invoke its helper channel. It records both executable
hashes in a private evidence directory.

Before opening it requires no known managed/native scanner owner, an empty
hopper, the exact PaperStream fi-7160 source, driver 3.40.2.1815/protocol 2.4 and
settings-only UI support. It configures and verifies the native worker's current
simplex RGB/native/600 DPI capture parameters and target-one image count in
state 4, checks the existing 2.7-by-3.6-inch frame, and then opens **ShowUIOnly**
once. These temporary standard-capability SETs are restored in reverse order
after closure; failures are reported. There is no normal acquisition Enable,
vendor SET, START, automatic retry or forced termination.

An independent broad Windows process check is still required before launch:
do not launch while another inspector, helper, NAPS2 job, counted worker or
PaperStream native server owns the scanner. Never kill an unidentified owner.
Keep hopper and transport empty throughout this inspection. Ask the operator to
read the initially selected profile and Advanced > Paper Feeding > Pre-Pick,
without selecting a different profile, and close **Cancel** unchanged. If UI
tools are unavailable, collect only that specific visible readback from the
operator. Source closure and setting restoration must finish before another
source is opened.

The private directory contains opened, configured, after-UI and restored
capability snapshots. Compare them with the explicit operator readback and the
process log. The configured snapshot shows whether standard capture preparation
altered the correlated vendor value; it does not replace visible readback.

Build with `tools/scanner-twain-count/build-probe.ps1` using the pinned
NAPS2.NTwain 1.0.1 package. Run `ProfileSettingsInspect.exe selftest` without a
scanner. The only driver-inspection invocation is:

```text
ProfileSettingsInspect.exe inspect-worker-profile-empty-clear <NEW absolute private evidence directory> <absolute known Mtg.CountedTwain.exe path>
```

This command is an operator-coordinated settings inspection, not a readiness or
feed authorization. Preserve the log and `.local-data` evidence privately; do
not commit scanner snapshots, cards or credentials.

## Qualification boundary

Compilation and motor-free selftests passed. The new worker-identity inspection
has not yet run; no effective worker Off state or physical stop is claimed.
Once effective Off is established, prepare a separately guarded diagnostic that
verifies its accepted capture/Pre-Pick state before one Enable. Obtain fresh
specific expendable-card loading/readiness for each bounded small test. Existing
CountFeed does not verify mechanical Pre-Pick and must not be run unchanged.
Stop on any extra movement, damage or uncertain transport; never automatically
retry, replay a Start or infer readiness from time passing. Earlier one/two/five
passes do not qualify larger counts, and ten images do not prove a ten-card stop.

Capacity, explicit next-section Start, Stop and same-batch early-empty refill
software acceptance is recorded in [SCANNER_SECTION_SERIES.md](SCANNER_SECTION_SERIES.md).
Physical acceptance remains separate. Retained originals, failure journals and
explicit Inventory confirmation remain required. No merge or production
deployment is authorized by these checks.
