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

- Full core verification: Prisma generation, typecheck, 974 unit checks, production build and all thirteen client-manifest checks.
- 21 model-free geometry checks, including complete white rims, clipping in all quarter turns, rounded corners/slight rotation, border/footer enclosure, uncertainty, inner printing, bent sides, noisy backing, multiple cards and unchanged PHOTO separation.
- 21 printing/registration/cache/descriptor uncertainty checks. A synthetic white-on-white example cannot provide a visible edge, but distributed reference features recover its known original-space rectangle within one source pixel. Automatic acceptance remains false.
- 18 focused TypeScript printing/review checks: normalized original-frame anchors, weak/clipped/legacy-size rejection, conflicting faces, stable identities and unchanged proposal/acceptance behavior.
- 233 retained scanner inputs × four rotations have identical baseline/candidate geometry and prepared pixels (932 comparisons). A separate exact-digest complete/clipped fi-7160 pair adds eight unchanged comparisons. No original source was altered. The initial 233-input replay included two earlier characterization images rather than the independently verified complete/clipped pair; its result is retained, and only the missing exact pair was added afterward.
- The synthetic padded-white baseline retained the full 770×1000 scan; the candidate encloses the known 630×880 card with a two-pixel outward allowance. This is geometry evidence, not physical-scanner or printing-accuracy evidence.
- Both affected complete browser workflows passed in 4.2 minutes with zero skips/retries: existing pointer/keyboard/touch repair, lost/rejected acknowledgements, stale edit/reset/saved-draft/Inventory fences; and ordinary three-image native processing of the exact complete/clipped originals plus synthetic white rim. The white-rim footer recovers `039` in the unchanged footer zone. Actual Blessing reference corners reach the selected-printing editor at desktop and 320px, with original downloads conserved and zero Inventory writes. Desktop/phone renderings were visually inspected. Existing fixture-owner records are removed after cleanup.
- Four selected review services replaced; all sixteen project services preserve their environment/mounts and twelve unselected services preserve container/image identity. Web is healthy and host login returns HTTP 200. Loaded web source digest `c3f7c0410b73739aefed556b6cd1ca8d393a4e9a8b8a2a9b8e838e94ee68cea9` (598 inputs) matches this checkout. Native source hashes are checked separately.

Retained setup failures: the first isolated printing-suite invocation lacked its Python runtime import path (three import errors); the corrected original suite passes. Initial Compose validation lacked the existing reference/model path variables and stopped before any container mutation; retry derived their unchanged paths from the actual local mounts. These are setup corrections, not accuracy or runtime-policy changes.

Synthetic white-rim and invisible-edge cases qualify bounded geometry and the reference aid; they do not establish unseen physical-card accuracy. Original retained scans are development regression material. Fresh scanner captures, frozen physical-boundary/printing labels and independent validation remain necessary to assess progress toward the accuracy target. Review-only inference is intentionally distinct from automatic anchor-guided OCR.

Scope tracked by [#741](https://github.com/sefaction/MTG-Archives/issues/741). Private original/native/browser artifacts remain in ignored `.local-data`; no photographs, private paths, raw OCR bundles or credentials are published.

Existing broader #306/#463 remain open. Physical scanner settings, missing-source-edge faults and hardware acceptance remain separate.
