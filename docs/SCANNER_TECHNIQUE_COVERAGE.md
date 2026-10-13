# Document-scanner recognition techniques

The target is correct name, set and collector number. Reliable outer-card geometry precedes every targeted region. Development controls do not establish 99% independent accuracy.

| Technique | Current behavior | Remaining work |
| --- | --- | --- |
| Physical framing | Conservative black/white-rim geometry, measured-clipping vetoes and editable manual boundaries. | Fresh independently labelled boundary-location evaluation. |
| Reference landmarks | Distributed SIFT/RANSAC alignments, source-pixel scanner rectangle checks and one bounded targeted reread. Native manual/commit/cancel, recovery and ordinary owner/run load controls are qualified. Original readings remain available. | Reusable scanner placement calibration beyond observed edges and matched public references; wider layout coverage. |
| Printed identifiers | Offline PP-OCRv5 English models read oriented title/footer strips. Parsing and catalogue lookup combine name/set/collector/language while retaining contradictions. Draft #759 adds original-resolution left-footer evidence. | Weak/fragmented identifiers, uncommon layouts and other-language accuracy. |
| Artwork/whole-card matching | Frozen DINOv2 retrieval and local-feature comparisons offer public-reference candidates. | Similar artwork does not prove exact printing; stronger discrimination of shared-art variants. |
| Lower-left stamps | Registered pixel evidence and verified reference annotations distinguish printing expectation from what is visible. Unreadable stays unknown. | Broader qualified templates, visibility coverage and exact-printing evaluation. |
| Printing detail windows | Registered type-line, footer and frame observations; pinned expansion-symbol shape recognition is implemented. Unsupported, partial and conflicting symbols remain uncertain. | Wider symbol/layout extraction. Offline common-frame discrimination has no demonstrated development gain and is not used for ranking. |
| Decision confidence | Versioned observations, source/lease fences, bounded work and separate human review/Inventory authority. | Calibrated exact-printing confidence and frozen independent scanner evaluation. Raw OCR/image similarity is not a probability. |

The user's proposed anchor fallback is implemented through matched reference landmarks: internal printed features can suggest the outline when the perimeter cannot be measured. Those outlines remain explicitly inferred. A reusable placement profile for consistent scanner image dimensions is still missing; hardware scan settings are separate. Such a profile must preserve observed clipping, orientation, uncertainty and manual corrections instead of treating a guessed edge as measured.

Prioritize qualifying the original-resolution footer read, then reusable scanner placement and independently labelled boundary/exact-printing evaluation. Preserve exact identifiers and stamp constraints. Missing measurements cannot count as support, and candidate-specific registration must not normalize away the difference being tested.

Finish and condition remain explicit operator choices. Current implementation and acceptance are recorded in [reference refinement](REFERENCE_ANCHOR_REFINEMENT.md), [printing memory](PRINTING_MEMORY.md), [expansion symbols](EXPANSION_SYMBOL_RECOGNITION.md), [source footer](SOURCE_FOOTER_IDENTIFIERS.md), [#463](https://github.com/sefaction/MTG-Archives/issues/463) and [#749](https://github.com/sefaction/MTG-Archives/issues/749).
