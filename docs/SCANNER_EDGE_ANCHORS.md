# Scanner edge detection and reference anchors

Direction, October 11, 2026: document-scanner exact printing accuracy is the priority. Success means the correct name, set and collector number, with roughly 99% practical reliability as the target. Boundary quality comes first. A consistent scanner frame plus printed landmarks can help infer an outline when the physical edge is unclear. This target is not an achieved accuracy claim.

## Current techniques and gaps

| Technique | Current behavior | Remaining work |
| --- | --- | --- |
| Scan geometry | Preserve tight/full scans; trim narrowly supported backing; fit straight dark outer rims; detect observed clipping; manual corner repair | Broader borderless/low-contrast envelope and independently labelled physical boundaries |
| OCR | Pinned local PaddleOCR; canonical title/footer zones; both directions; supplemental footer and bounded whole-image recovery | More reliable exact footer reads and supported-language evaluation |
| Image retrieval | DINO embeddings, four rotations, full published reference index and SIFT geometric reranking | Measured candidate scoping/routing and missing reference coverage |
| Reference anchors | Distributed SIFT features plus RANSAC project a reference's outer rectangle onto the original; printing/stamp stage already computes this | Automatic anchor-guided OCR re-reading needs versioned lineage, loop prevention and independent qualification |
| Printing detail | Registered lower-left stamp checks, catalog original/List expectations, exact identifier reconciliation | General set-symbol, frame/treatment and footer-image discrimination |
| Corrections | Private independent original/evidence library and saved human decision history; sampled controls | Independently verified labels, fresh scanner evaluation and measured promotion |

These are current-source capabilities, not a claim that every open acquisition phase is finished. Multi-card photos, webcam/inbox inputs and optional GPU qualification are separate directions and do not lead this scanner-focused batch. Finish and condition remain explicit rather than inferred from a single ordinary scan.

## This batch

`scanner-white-card-edges` detects a bright outer rim on neutral gray backing. It uses a bright-pixel silhouette solely to call the existing exterior line fitter. Four original-pixel backing checks, near-white rim support, rectangularity, aspect, straight sides, outward enclosure and clipping guards remain required. It never gives the temporary silhouette to OCR, image retrieval or storage. Dark-rim detection runs first and PHOTO geometry is unchanged.

The supported backing is neutral and stable at the sampled margins, with channel medians from 100 through 225 and a near-white rim at 245 or above. These are conservative development bounds, not calibrated probabilities. Pure-white backing/white borders, weak/colored/noisy backing and unclear borderless outlines retain the full-scan/manual workflow. Three supported margins can establish observed clipping; missing pixels are never reconstructed.

Printing results now retain EXIF-normalized original dimensions. Strong distributed reference alignment can provide normalized, in-frame corners for the selected printing. Small sources, weak/localized features, high reprojection error, invalid or out-of-frame polygons, stamp conflicts and disagreeing face proposals withhold this aid. Reference corners are inferred from printing landmarks, not measured physical edges. No reference-label truth is supplied to the recognizer.

The boundary editor starts from this aid when there is no saved manual boundary and offers **Use reference outline**. Existing saved boundaries win. The user checks or adjusts the corners and chooses **Apply boundary and recheck**, using the existing revision-fenced, idempotent repair path. Printing drafts and saved decisions retain their existing protections. No automatic region application, suggestion ranking, acceptance or Inventory policy changes.

## Qualification

Local qualification passed:

- Final full core verification: Prisma generation, typecheck, 975 unit checks, production build and all thirteen client-manifest checks.
- 21 model-free geometry checks, including complete white rims, clipping in all quarter turns, rounded corners/slight rotation, border/footer enclosure, uncertainty, inner printing, bent sides, noisy backing, multiple cards and unchanged PHOTO separation.
- 21 printing/registration/cache/descriptor uncertainty checks. A synthetic white-on-white example cannot provide a visible edge, but distributed reference features recover its known original-space rectangle within one source pixel. Automatic acceptance remains false.
- 19 TypeScript printing/review checks within the final core suite: normalized original-frame anchors, weak/clipped/legacy-size rejection, conflicting faces, stable identities, observed clipping precedence and unchanged proposal/acceptance behavior.
- 233 retained scanner inputs × four rotations have identical baseline/candidate geometry and prepared pixels (932 comparisons). A separate exact-digest complete/clipped fi-7160 pair adds eight unchanged comparisons. No original source was altered. The initial 233-input replay included two earlier characterization images rather than the independently verified complete/clipped pair; its result is retained, and only the missing exact pair was added afterward.
- The synthetic padded-white baseline retained the full 770×1000 scan; the candidate encloses the known 630×880 card with a two-pixel outward allowance. This is geometry evidence, not physical-scanner or printing-accuracy evidence.
- Both affected complete browser workflows passed in 4.2 minutes with zero skips/retries: existing pointer/keyboard/touch repair, lost/rejected acknowledgements, stale edit/reset/saved-draft/Inventory fences; and ordinary three-image native processing of the exact complete/clipped originals plus synthetic white rim. The white-rim footer recovers `039` in the unchanged footer zone. Actual Blessing reference corners reach the selected-printing editor at desktop and 320px, with original downloads conserved and zero Inventory writes. Desktop/phone renderings were visually inspected. Existing fixture-owner records are removed after cleanup.
- Four selected review services replaced; all sixteen project services preserve their environment/mounts and twelve unselected services preserve container/image identity. Final web source digest `0822bbc60eeabc1963d573d6b9e4b246f55cd7eeb1bb3b1b0ad6960c8f5ef2b4` (598 inputs) matches this checkout. Geometry source `6f911253ac85ea7ff7798da37bfa04077baf9257dc7dd302110c97d527972fa9` matches loaded OCR/visual workers; printing worker source `088930f5cc387cb285de356d172a165a5046ba7d8bbf698a73f6350e1ad4b5c4` matches the host. Native image/source changed only for this batch; the final clipping projection required a web-only rebuild.

Retained setup failures: the first isolated printing-suite invocation lacked its Python runtime import path (three import errors); the corrected original suite passes. Initial Compose validation lacked the existing reference/model path variables and stopped before any container mutation; retry derived their unchanged paths from the actual local mounts. These are setup corrections, not accuracy or runtime-policy changes.

The first successful native workflow retained a reference rectangle inside the known clipped original. Its public reference crop does not establish missing physical edges. A server review-projection guard now withholds that editable aid while retaining archived native measurements and the rescan guidance. The initial guard's TypeScript optional-field inference failed typecheck before tests; preserving an explicit optional `undefined` value (omitted on the wire) repairs the type without exposing an outline. All 975 final core checks pass. The first final-image browser recheck failed at login with `ERR_EMPTY_RESPONSE` before any scan upload because web startup was unfinished; its artifacts and cleanup result are retained. After health and actual host HTTP 200, only the affected full native workflow is repeated with its original cases/deadlines and the new clipping-veto assertion.

The final three-input native/browser repeat passes in 5.5 minutes with zero skips/retries. The real complete scan offers its inferred outline; the clipped scan offers none in review despite retained internal reference measurements. The synthetic white-rim footer, original hashes, unchanged zones, desktop/phone rendering and zero Inventory assertions all pass. All recorded owned scanner fixtures are absent afterward; the review app remains healthy with exact final source identity. [Sanitized qualification](../tools/acquisition-eval/scanner-edge-anchor-qualification.json) records source hashes, counts, retained failures and limits. Both the initial successful native run and failed startup recheck remain separate evidence rather than being relabelled as the final pass.

The separate existing manual-boundary fixture intentionally adds one disposable copy to test the post-commit edit fence and removes that owned Inventory/source data during teardown; the native scanner fixture writes none. Its terminal independent-library audit found one new empty account after the manual fixture ended, alongside three older empty accounts. Only the exact current account was recovered after verifying its creation timestamp, absent owner/session and zero blobs/evidence/reservations. The three historical records remain untouched. This existing fixture-cleanup gap is catalogued separately in [#743](https://github.com/sefaction/MTG-Archives/issues/743), under #692; PR #742 does not claim to repair that fixture or explain its late writer. All current owned data is absent after the scoped recovery.

Synthetic white-rim and invisible-edge cases qualify bounded geometry and the reference aid; they do not establish unseen physical-card accuracy. Original retained scans are development regression material. Fresh scanner captures, frozen physical-boundary/printing labels and independent validation remain necessary to assess progress toward the accuracy target. Review-only inference is intentionally distinct from automatic anchor-guided OCR.

Scope tracked by [#741](https://github.com/sefaction/MTG-Archives/issues/741), delivered for individual review in [PR #742](https://github.com/sefaction/MTG-Archives/pull/742). Private original/native/browser artifacts remain in ignored `.local-data`; no photographs, private paths, raw OCR bundles or credentials are published.

Existing broader #306/#463 remain open. Physical scanner settings, missing-source-edge faults and hardware acceptance remain separate.

## Next scanner accuracy batch

Use the inferred outline for one bounded, versioned second OCR pass when direct edges are unresolved. Bind that pass to the unchanged original, current reference/catalog/model generation and parent observations; distinguish inference from an operator's manual selection. Prevent repeat-refinement loops and preserve manual decisions. Observed clipping must veto inferred repair even when a reference's public crop fits inside the captured source.

Evaluate boundary location and exact first printing separately on paired scanner inputs. Score all eligible cards, including failures/uncertain results, rather than counting an expected printing somewhere among alternatives as a successful identification. Freeze new physical-boundary and printing labels separately from development tuning; report any physically indistinguishable printing families and repeated-card grouping. No new physical feed is authorized by this software batch.
