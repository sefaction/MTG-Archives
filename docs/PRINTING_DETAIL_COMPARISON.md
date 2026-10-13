# Registered printing detail inspection

Issue [#749](https://github.com/sefaction/MTG-Archives/issues/749) extends scanner recognition beyond the existing lower-left stamp check. This first batch measures and displays five registered windows: the type-line band, set-symbol area, footer, and left/right frames. These are fixed spatial windows, not semantic symbol or treatment classifiers. Different card layouts can put useful identifiers outside a window.

Native measurement uses only printing candidates already proposed by the recognition pipeline. It registers each reference independently against the unchanged original. Every comparison displacement must contain observed source pixels; clipped padding, failed alignment, small sources and blurred textured details remain unreadable. Correlation searches at most four canonical pixels in either direction. An optional color residual uses a lighting fit from independently visible artwork, never from the detail under comparison. Blank frames need that independent lighting support. These are descriptive measurements, not probabilities.

The advanced review panel shows scan and public reference crops for the selected printing. Reference bytes must match the saved reference SHA-256 and the allowed public card/face URL. Unsupported selections explain that no comparison is available. Front/back ambiguity requires an explicit face choice. Existing observed-clipping projection withholds the reference outline, which also withholds these previews. Numerical measurements remain in native evidence; the review projection exposes only region availability. Neither proposal ranking, automatic acceptance nor Inventory authority changes. Original OCR and stamp evidence remain authoritative under their existing rules.

Native and application envelopes retain their existing bounds. If optional detail fields exceed the budget, only those new fields are removed. The original observations, proposals and stamp results remain intact; pre-existing oversized output still fails. The native generation descriptor includes the new measurement implementation so cached observations cannot silently acquire a different measurement policy.

## Development replay and rejected policy

The read-only evaluator replays frozen, actually observed candidate faces. Physical labels enter scoring only after measurement. Original, index and reference manifest hashes are checked before and after inference. Private images, labels, identities and per-card measurements stay in ignored local storage; only aggregate evidence is published.

On 67 labelled playable development inputs from a 90-entry retained manifest, the historical saved first proposal was correct on 58. A diagnostic mean color-residual ranking also scored 58, with three apparent gains and three losses. Two apparent gains arose because the former first proposal had no comparable observed face: treating missing measurements as infinity manufactured a preference. Original/List counterpart changes also depend on a stamp deliberately outside these windows. Another loss replaced the correct collector number with a visually similar printing after a tiny residual difference. This diagnostic ranking is **rejected** and is never called by the application.

This retained set has unknown physical-copy independence and has been used during development. It establishes neither current application accuracy nor progress to 99%. Candidate-dependent registration and lighting can normalize away genuine physical frame differences. The next recognition-policy work needs a common verified physical frame, pairwise distinguishing regions, preservation of exact printed identifiers and stamp constraints, and a frozen independent scanner benchmark. Unsupported/missing comparisons must remain unknown rather than become positive ranking evidence.

## Delivery and remaining work

This batch is stacked on the edge/reference-outline work in PR #742. The cumulative local review must also retain the canonical JSON precision fix from PR #747. The separate one-pass anchor reread in draft PR #748 has its own runtime qualification and is not implied by these measurements. All remain subject to individual merge approval.

Recorded qualification and remaining gates are in `tools/acquisition-eval/printing-detail-qualification.json` and `docs/WORK_CHECKPOINT.md`. Issue #749 remains open for the general printing discrimination policy and independent qualification even after a review-only implementation is ready.
