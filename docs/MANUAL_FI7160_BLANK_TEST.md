# fi-7160 blank-page retention: supervised manual test

Related: [#610](https://github.com/sefaction/MTG-Archives/issues/610), [#313](https://github.com/sefaction/MTG-Archives/issues/313), [#501](https://github.com/sefaction/MTG-Archives/issues/501).

Status: one supervised two-image attempt completed October 10, 2026. Light-card retention and the two-of-three physical boundary passed for the actual specimens. True blank-page acceptance remains INCOMPLETE: inspection showed that the first specimen has printed logos/text, and Brian has no completely unprinted specimen available. Brian subsequently confirmed the scanner empty and clear; later motor-free settings inspection gracefully closed the local helper. These are timestamped observations, not readiness authorization for a future feed.

## Purpose and prerequisites

Show that the current guarded counted profile retains the blank-facing card as an original, so two requested images do not silently consume a third physical card. This tests retention on the selected specimen/profile; recognition of a blank face is not expected, and broader DPI/duplex/crop/reliability characterization remains separate.

- Local origin only: `http://127.0.0.1:13001/`. Brian explicitly permitted operation of the local test UI after reconnecting it.
- Installed helper metadata: `0.4.3+163257e3881f2e4dc4a7f54da8fef1b3ffd403e1`.
- Record actual web image/source fence, worker images, driver/source/settings and native proof for this attempt. Prior observed web image: `sha256:d1aec94b0fb0a698635bc82448014d589a2dadb82cf51f77fbe551456e8e7be6`; recheck before Start because another worker may update web.
- Use only the guarded `fi-7160 (Cards, Pre-Pick Off)` source: the qualified 600-DPI RGB24 simplex/count profile. Do not change blank-discard to Auto or enable duplex to create a comparison.
- Check current local agent online, no pending/active old scanner command, no other scanner owner, and worker coordination before preparing the test.
- Confirm current Cards/Pre-Pick Off settings through the established guarded preparation evidence. If unavailable or refused, stop and investigate; do not switch to the generic scanner route.
- New test batch with explicit target two and an identified test destination. Reserve two copies only; save no review or Inventory addition as part of retention qualification.
- Feeder stays empty during setup. Exact loading confirmation is required immediately before one physical Start.

## One supervised attempt

1. Prepare the local two-card test form while the scanner is empty. Record its exact source, destination and requested count.
2. Ask Brian to arrange three expendable unsleeved cards in known feed order: blank-faced specimen first, printed card second, extra printed card third. The blank face must face the same scanning side as an ordinary card front. Record which specimen/face is used; ask rather than guess mechanical orientation.
3. Obtain explicit confirmation of that loading, clear transport and readiness for ONE two-image Start. Elapsed time, the earlier empty-feeder response or the materials-available response is not feed authorization.
4. Start once. Retain every original and receipt. No automatic retry or forced process shutdown. Any refusal, excess transfer, unexpected movement or damage ends progression for reconciliation.
5. Verify two images were retained in order: blank face, then printed card. Inspect the full original blank image rather than infer blank retention from the image counter or recognition result. Record any preparation/recognition error without discarding its original.
6. Ask Brian to confirm two physical exits, the third card wholly in the hopper, clear transport and undamaged cards. Software image counts cannot establish these observations.
7. Verify native terminal outcome, twelve-setting restoration, source/DSM/loop closure and actual child exit; no native acquisition owner remains. Verify helper/server artifact SHA256/length, receipt identities and contiguous image order.
8. Verify no Inventory commit occurred and existing data/services remain conserved. Ask Brian to remove the remaining card and confirm the scanner is empty and clear before another activity.

## Result record

| Item | Evidence / result |
| --- | --- |
| Exact test batch/run and build | Local batch 1850, session `9ca21b6a-561c-4d1f-b4cb-8fb9c7eb7a08`, ScannerRun `e58dbe4d-1768-4562-865e-ffc7edd92780`; web image `sha256:d1aec94b0fb0a698635bc82448014d589a2dadb82cf51f77fbe551456e8e7be6`, loaded source fence `a7377bcfbcf24f81e5d6f8774152a70537799bcb5b76f9beaad08252dc76cddb`; helper version above. Start created 20:51:48 UTC. |
| Source/driver/profile proof | Guarded CountedTwain PaperStream IP fi-7160, `fi-7160 (Cards, Pre-Pick Off)`, requested two, 600-DPI RGB24 simplex, 2.7 x 3.6 centered; native guarded configuration/closure validation passed. Fresh raw twelve-setting snapshots were not separately captured. |
| Blank specimen and scanned face | First original is printed reverse of Final Fantasy art-series Machinist's Arsenal, 2/53, Thanh Tuan. Predominantly light face but substantial logos/text: not a true blank. Second is Old Thrush HOB #0002 EN. |
| One-Start authorization | Brian: "Loaded as described; ready for one two-image Start" after exact three-card feed-order/clear-transport/source/watching request. Exactly one Start; no retry. |
| Retained originals/order/receipts | Two originals, contiguous sequences 1/2. Fresh file SHA256/length agree with manifests and server records; ready receipts bind exact run/artifact/sequence/photo/digest. First 6,373,366 bytes / `7ce713b577a6a443988eb5202bfc3e1f12f64ea4cca08730ae891837c01be508`; second 6,749,617 bytes / `57cfbf6e58e4472359f6bcef875e6295c9ec8ae11d6b68a8e57e99c318876457`. Originals visually inspected. |
| Operator boundary/damage/transport observation | Brian confirmed exactly two exits, third wholly in hopper, clear transport and no visible damage. Then removed third and confirmed empty/clear. Software physicalBoundary remains UNKNOWN; human observation is recorded here separately. |
| Restoration/closure/actual exit | Run DRAINED, COMPLETED, imageCount 2, nativeError null. Terminal event at 20:52:17 UTC: "Source disabled, settings restored and DSM closed". Guarded backend accepts completion only after clean closure/restoration and successful child exit; subsequent process inventory had no native acquisition owner. |
| Inventory and original-data conservation | Before/after full Inventory projection identical: 10,292 rows / 12,495 copies / MD5 `6d0e5b68f78360a7e75439952bbee87d`. Existing 31 full ScannerRun rows unchanged; 1,093 original-photo metadata projections unchanged. This is not a fresh byte audit of all old originals. Project service names/IDs/images/states unchanged. Two new test photos retained; no Inventory commit during this test. |
| Outcome | PASS for light-card retention/order and this two-of-three boundary. True blank suppression INCOMPLETE, no actual true-blank specimen tested. #610 stays open. |

Private evidence: `.local-data/manual-fi7160-blank-20261010/` contains before/after database projections, service snapshots, prepared/review screenshots, test run/events and artifact checks. Original photos stay in the helper/server; no private images are published to GitHub. Faint magenta lines are visible in both originals; this observation alone does not diagnose a new defect or establish an issue resolution.

GitHub outcomes recorded: [#610 scoped acceptance](https://github.com/sefaction/MTG-Archives/issues/610#issuecomment-6102108201), [#313 cross-reference](https://github.com/sefaction/MTG-Archives/issues/313#issuecomment-6102110289). Both issues remain open.

## Real scanner review and Inventory result — October 10

Related: #506/#501. Same actual acquisition/build above; no additional feed or Docker reload. This is a bounded real-hardware desktop handoff pass, not closure of the entire UI/production/phone/scale audit.

Live outcome: [#506 scoped real-hardware review/Inventory acceptance](https://github.com/sefaction/MTG-Archives/issues/506#issuecomment-6102227800). The issue remains open for its broader acceptance scope.

| Check | Actual result |
| --- | --- |
| Human match/details review | Brian compared physical Card2 and answered "Confirmed Card 2; next Inventory action is easy to find". Saved selection Old Thrush HOB #2 EN, NONFOIL/NM. Card1's incorrect art-card/Thrun proposal remains unconfirmed. |
| Review persistence | Actual refresh retained both complete candidate rows/revisions/hashes, including Card2 saved review at revision3; Inventory remained10,292rows/12,495copies/hash6d0e5b68f78360a7e75439952bbee87d, zero commits. |
| Selection and preview | Continue to Inventory selected only Card2. Preview explicitly showed1copy, Old Thrush/hob2/nonfoil/NM/en, destination Scanner qualification - 25-card boundary / A,0stored/50capacity. Preview made no Inventory change. |
| Human final step | Brian answered "Added one copy successfully; final step was clear" and requested a recheck. First inspection at21:07:23UTC had zero commits; actual commit was created21:07:59UTC and subsequent check21:08:24 found one. Preserve this observation ordering; no product-latency cause or failed commit is inferred. Agent did not click the final button or retry. |
| Exact Inventory delta | One new quantity1 row `cmv2vyn5e000woalrttn9mkb0` with expected printing/owner/destination A/nonfoil/NM/en/ACQUISITION/unknown original opener. All10,292 original full Inventory rows unchanged, none removed/modified. Totals10,293rows/12,496copies/hash `d904c5f6f74b6a8307ba78926d517788`. |
| Durable accounting | Exactly one AcquisitionCommit `b077a025-5bb6-448b-aa9e-ebb091957abd`, one member for Card2 candidate `cmv2vegqr000eoalryeumt1vl`, one acquisition_committed audit with0→1quantity and photo/review/destination identity. Card1 has no review or commit member; two captures = one committed + one pending. |
| Committed refresh | UI reload keeps1added/1awaiting/0ready; committed Card2 has no edit/selection/Continue/Confirm actions. Full commit/member/stock/audit and complete Inventory projection unchanged across reload; no duplicate commit. Both test-photo digest/bytes/ready/unpurged projections retained. |
| Services and evidence scope | Original13 running service names/IDs/images/states unchanged. Initial final comparison mixed running-only baseline with all-container final and rejected six extra stopped entries; corrected matching running-scope comparison PASS. Stopped service histories were not independently baselined. No new old-photo byte audit. |

Private evidence in the same directory includes `review-saved-before-refresh.json`, `review-saved-after-refresh.json`, `inventory-preview.png`, full private before/after Inventory snapshots, `inventory-delta-check.json`, `commit-after.json`, `commit-audit-and-originals.json`, `commit-after-refresh.json`, `inventory-after-refresh.png`, and `service-scope-check.json`. Intentional test photos, run, saved review and one Inventory copy are retained for recovery; do not silently remove them as worker fixtures.

Record pass, fail or inconclusive only from actual evidence. A failed or inconclusive attempt remains visible even after a later pass. Link the scoped result to #610 and #313; close an issue only after checking its complete live acceptance scope. No production deployment or broader H01-H10 acceptance follows from this one test.
