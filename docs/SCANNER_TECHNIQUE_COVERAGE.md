# Document-scanner recognition techniques

The target is correct name, set and collector number. Reliable outer-card geometry precedes every targeted region. This inventory separates existing mechanisms from unfinished recognition work; passing development controls does not establish99% independent accuracy.

| Technique | Current behavior | Remaining work |
| --- | --- | --- |
| Physical framing | Conservative black/white-rim geometry, measured-clipping vetoes and editable manual boundaries. | Fresh independently labelled boundary-location evaluation. |
| Reference landmarks | Distributed SIFT/RANSAC alignments, source-pixel scanner rectangle checks and one bounded targeted reread. Original readings remain available. | Remaining native manual/commit/cancel/load acceptance; reusable scanner placement fallback beyond observed edges/matched references. |
| Printed identifiers | Offline PP-OCRv5 English models read oriented title/footer strips; footer parsing and catalogue lookup combine name/set/collector/language evidence while retaining contradictions. | More coverage of weak/fragmented text and printing families; other-language accuracy is unqualified. |
| Artwork/whole-card matching | Frozen DINOv2 retrieval and local-feature comparisons offer public-reference candidates. | Similar artwork does not prove exact printing; resolve shared-art variants. |
| Lower-left stamps | Registered pixel evidence and verified reference annotations distinguish printing expectation from what is visible. Unreadable stays unknown. | Broader qualified template/visibility coverage and exact-printing evaluation. |
| Printing detail windows | Type-line, symbol-area, footer and frame measurements plus digest-verified scan/reference inspection. | Semantic expansion-symbol recognition is explicitly unimplemented. General printing discrimination remains #749; naive mean residual ranking was rejected. |
| Decision confidence | Versioned observations, one-pass/lease/source fences and separate human review/Inventory authority. | Calibrated exact-printing confidence and frozen independent scanner evaluation. Raw OCR/image similarity is not a probability. |

Prioritize completing the guarded anchor workflow, then semantic symbol evidence and distinguishing print details under a common physical frame. Preserve exact printed identifiers and stamp constraints. Missing measurements cannot count as support, and candidate-specific registration must not normalize away the difference being tested. The inspected native input path supports manual/reference hints, with no reusable scanner-specific placement calibration currently implemented in that analysis path; hardware scan settings are separate.

Finish and condition remain explicit operator choices. This recognition scope does not authorize unattended physical feeding or claim automatic grading. Current implementation/acceptance is in [reference refinement](REFERENCE_ANCHOR_REFINEMENT.md), [printing memory](PRINTING_MEMORY.md), [#463](https://github.com/sefaction/MTG-Archives/issues/463), [#744](https://github.com/sefaction/MTG-Archives/issues/744) and [#749](https://github.com/sefaction/MTG-Archives/issues/749).
