# fi-7160 counted feeding: first physical gates

October 2, 2026. Main baseline `dbf3f637`. Related: #313 physical characterization,
#312 native adapter, #501 delivery, #506 workflow and #597 capacity/refill
implementation. This is a private Windows
diagnostic batch, separate from the installed scanner helper and website feeding.

## Result

With **three expendable cards loaded**, two separate target-one trials emitted
exactly one card. The operator confirmed that both remaining cards stayed wholly
in the hopper, the transport was clear, and the emitted card was undamaged.
A target-two trial then emitted exactly two; the third stayed wholly in the
hopper. The operator inspected the emitted cards and unloaded the remaining card.
No additional card was physically advanced in these three observed trials.

Each run used one source Enable, returned the requested number of complete PNGs,
reported SourceDisabled in TWAIN state 4, restored/read back the changed settings,
and closed source/DSM successfully. No cancellation after image delivery, retry,
website upload, recognition, Inventory preview or Inventory commit occurred.

These are **three small mechanical observations**. They do not establish 83-card
feeding, general card-surface safety, larger loads, duplex, USB recovery, website
capacity control, or refill continuity. CAP_XFERCOUNT remains an image count.

## Profile and discovery

- Windows 10.0.22631, x86 .NET Framework diagnostic, system legacy `twain_32.dll`.
- Exact source `PaperStream IP fi-7160`, PaperStream IP TWAIN 3.40.2.1815,
  source protocol 2.4. USB/PnP fi-7160 reported OK.
- Pinned NAPS2.NTwain 1.0.1; upstream commit
  `216c8c614d1514638cace41e5aa7e7ce48448d78`, existing MIT package.
- Feeder enabled, simplex, automatic feed enabled, **CAP_AUTOSCAN=false**,
  **CAP_XFERCOUNT=1 or 2**, native transfer, RGB/24-bit/600 DPI. Every requested
  setting was accepted and read back before enabling.
- Driver current image frame retained: approximately 2.7 by 3.6 inches.
  Actual PNGs: 1620 by 2160 pixels. No frame/crop/deskew changes. The first
  successful image was visually inspected; the card/footer and physical rim are
  present. This is not an independent recognition or crop-quality benchmark.
- CAP_SHEETCOUNT (TWAIN ID 0x104f) was unavailable through QUERY-supported
  operations; CAP_FEEDERPREP was also unavailable. AUTOFEED/AUTOSCAN/XFERCOUNT
  were readable/writable. Both count-one and autoscan-off motor-free negotiations
  restored their prior values successfully.

The standalone probe using the system modern DSM initially listed only Plustek.
The legacy DSM listed the actual PaperStream source and a separate WIA bridge;
the diagnostic now selects the exact PaperStream source and excludes the bridge.
The project's **unmodified pinned NAPS2 SDK 1.3.0** also successfully discovered
both fi-7160 WIA and PaperStream TWAIN sources. Therefore this is a standalone
probe/DSM difference, not evidence that the installed driver is absent or that
the website needs a discovery change. No driver was installed or altered.

## Retained attempts

Private journals/originals are under this worktree's `.local-data/`. No card
images or private SDK logs are included in GitHub.

| Attempt | UTC | Result |
| --- | --- | --- |
| system modern DSM probe | before 23:12 | no fi-7160 source; no source Enable |
| legacy discovery with broad model match | before 23:12 | both PaperStream/WIA matched; safely refused before source Open |
| exact PaperStream negotiation | before 23:15 | count-one/autoscan-off accepted/read back/restored; no Enable |
| first requested-card-frame setup | 23:15:34–35 | driver rejected centered 2.6x3.6 frame; safely refused before Enable, zero images; this early version did not restore other settings before close |
| target one, three loaded | 23:18:03–10 | one PNG; operator observed one undamaged exit and two wholly in hopper |
| target one repeat, three loaded | 23:20:21–27 | one PNG; same operator observations |
| target two, three loaded | 23:24:45–53 | two PNGs; operator observed two undamaged exits and third wholly in hopper |

Successful run-directory suffixes: `physical-one-d6f48ddf93134e7182def51ad58211d7`,
`physical-repeat-1edc04c408db4e9fba97d01c382abf24`,
`physical-two-c2eaee3a984d45dca7adee9b37be3b6c`. All failed attempts remain separate.

## Tools and operating guard

`tools/scanner-twain-count/build-probe.ps1` compiles against the existing exact
NuGet cache with the Windows .NET Framework compiler. Output stays under
`.local-data/twain-count-probe`; no binary is committed or installed.

```powershell
& tools/scanner-twain-count/build-probe.ps1
& .local-data/twain-count-probe/CountFeed.exe selftest
# Motor-free; only after operator confirms an empty hopper and transport:
& .local-data/twain-count-probe/CountProbe.exe probe-empty-hopper-old-dsm
```

Physical commands are `feed-one-of-three` and `feed-two-of-three`, followed by
a **new absolute private directory** and `operator-ready`. They require fresh
operator loading/clear-transport confirmation. No arbitrary larger count is
enabled. Existing journals cannot authorize a refeed. Existing helper, NAPS2
worker, probe or another count-feed process prevents the test from starting.
Every changed setting is restored after normal source disable or pre-enable
failure. Rejected/clamped/unknown settings prevent Enable. All complete returned
images are retained, including unexpected extra transfers, which fail the gate.
Uncertain active transport waits without automatic cancellation or refeeding.
Stop further tests on overfeed, damage, jams, uncertain transport or ownership.

Four pre-existing helper connections were identified by exact process paths,
parent/child identities, connection IDs and saved non-secret origins. The local
snapshot had zero QUEUED/STARTED runs; the operator also confirmed no other job.
Only those idle helper processes and their child TWAIN workers were stopped.
Credentials, enrollment records and original journals were preserved. After the
operator unloaded the final remaining card, only the most recent local connection
was restored: `6f860457-c7c0-440e-8cda-1786077970c2` at port 13001. Two older local
duplicates and the Unraid connection remain stopped to retain one test owner.
No production website or deployment was changed. Their saved `serve <agent-id>`
commands remain in the private checkpoint; do not automatically restart them
during count qualification.

## Software checks and local review

- Both diagnostics compiled successfully; motor-free policy selftest passed
  readiness/count allowlist, rejected/clamped/unlimited readbacks and journal
  replay refusal. Timeout/error-transport behavior remains unqualified hardware.
  The Windows scanner workflow also builds/runs this selftest without a device.
- Existing helper built with locked packages on .NET SDK 8.0.425; two existing
  nullable warnings in ScannerDiagnosticSelfTest, zero errors.
- Native helper selftests passed preflight/no-START failures, denial/drain,
  original retention, lost acknowledgements and recovery **without refeeding**.
- 25 focused existing scanner/domain tests passed, zero skips.
- All 797 core tests passed, zero failures/skips, after correcting sandbox Git
  worktree ownership access. Initial ownership-failed log retained separately.
- Typecheck passed.
- The running local Docker application is unchanged and exactly matches current
  main: 525 inputs, digest
  `2a838bb05796f4f8f5415b6be74865dc8bfaf21ad48e966442d053467ec6744b`, web image
  `02f53dc24a9e3188bd76d338e470e6d6c3ed56d14c284441812abe5b75511b5b`.
  New-worktree line endings and staged installer were matched only after verifying
  each against the running manifest and normalized main source. Application
  source is unchanged apart from local checkout line endings; those bytes are
  excluded from the diagnostic commit. No rebuild or reload was needed.
- Desktop sidebar association was not observed. Repository cwd/worktree identity
  is verified; that alone does not prove desktop project association.

## Application work still required

The shipped NAPS2 path does not configure a native count, uses a null image-stop
budget, and deliberately drains after Stop. Its physical target is a logical
allocation. This diagnostic has **not changed that behavior**.

1. Integrate a verified pre-Enable count path at the generic scanner boundary.
   Maintain stored originals, execution/epoch/claim fencing and no automatic
   recovery feed. Support only separately qualified simplex profiles; do not
   substitute transfer-count qualification for physical observation.
2. Reserve capacity transactionally before feeding. Count committed physical
   copies, scanned-but-uncommitted candidates, and in-flight allocations across
   sessions, respecting both section and parent limits. Prevent concurrent claims
   from both consuming the same 83 free spaces. Avoid double-counting candidates
   as their explicit Inventory receipts commit. Preserve ordinary advisory manual
   Inventory behavior and separate final Inventory confirmation.
3. Introduce explicit refill segments under the same unfinished logical batch.
   Current ScannerRun/AcquisitionRun is one-to-one, transfer sequences start at
   zero, and natural early exhaustion completes the acquisition session.
   A refill needs a new physical execution identity and segment journal/sequence
   binding; crash recovery of an existing segment must remain delivery-only.
4. After an observed early-empty segment, keep the unfinished logical target and
   prior images/reviews. Wait for operator refill and explicit Resume. After the
   selected section's allocation is filled, wait for the next section choice;
   do not enable another physical run automatically. Refresh capacity at each
   segment/next-section admission and preserve explicit Inventory confirmation.

Next gates: application fake/native transport and real PostgreSQL tests for
2 free/3 loaded, 83 free/more loaded, concurrent pending capacity, early-empty
plus explicit refill/resume, and recovery without refeeding; then operator
qualified small integrated feeds before scaling to 83. No 83-card physical test
or same-logical-batch refill has passed yet.
