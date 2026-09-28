# Printing evidence experiment

Part of recognition goal #463. This is an offline experiment, not the deployed
recognizer or permission to confirm a printing. Local application remains #472.

## Method under evaluation

- Align a candidate reference to the photograph using distributed SIFT features,
  ratio-filtered matches and RANSAC homography. Reject weak, localized, mirrored
  or invalid fits. Retain the whole-card outline and an observed-pixel mask.
- Search the aligned lower-left area using public old/modern-frame stamp templates across
  a bounded range of sizes. Keep scores as diagnostic values, not probabilities.
- Require visible pixels, sufficient source resolution and readable adjacent
  footer detail. Return PRESENT for observed symbol shape; return ABSENT only
  when the local region positively agrees with an independently verified unstamped reference, including
  its fine printing. Compare both mean and upper-tail residuals so a localized
  mark is not averaged away. Refine small offsets and exposure from adjacent
  printing, excluding the stamp area. Unknown reference annotations cannot support
  absence. Other outcomes are UNREADABLE with an explicit reason.
- Never equate shared artwork/alignment with exact printing. Stamp presence also
  does not alone distinguish List from every Mystery Booster release.

The registration and template primitives follow the official OpenCV
[feature/homography tutorial](https://docs.opencv.org/4.13.0/d1/de0/tutorial_py_feature_homography.html)
and [template-matching tutorial](https://docs.opencv.org/4.13.0/d4/dc6/tutorial_py_template_matching.html).
These sources establish the techniques, not their MTG accuracy or our thresholds.

## Evidence boundaries

`diagnose_printing.py` deliberately uses the labelled printing as the candidate
reference to isolate alignment and stamp behavior. Its output is **not** retrieval
or end-to-end accuracy. Missing public references remain explicit unavailable
results. Public Saber Ants and Timberland Ancient List references supply templates; private
photographs never become templates and never leave the local installation.

Synthetic checks cover missing alignment, clipped pixels, low resolution, blur,
glare, unexplained marks and a stamped-reference mismatch. Real comparisons use
the 23-photo Android development corpus, 17 scanner comparisons and 28 newly
labelled Android photographs. The latter contain 24 printing groups; repeated
photos/physical-copy ambiguity prevent an independent held-out claim.

The first experiment aligned all23 Android photographs, found2/3 known stamps,
and left the third unreadable. It produced no ABSENT decisions on that corpus.
This revealed that requiring a blank region prevents absence checks on modern
cards with footer text. Version2 instead requires local reference agreement,
without lowering the presence threshold. Versions3/4 add adjacent-printing
registration/exposure checks and require independently inspected, hash-bound
public-reference stamp annotations. All50 available reference footers were
inspected separately (3 present,47 absent); these are reference annotations,
not predictions about the photographed card. Unannotated/changed references
remain unknown.

Version4 results on the partial73,661-reference snapshot:

| Corpus | Photos | Reference unavailable | Present | Absent | Unreadable |
| --- | ---: | ---: | ---: | ---: | ---: |
| Prior Android | 23 | 0 | 2 | 0 | 21 |
| Scanner | 17 | 6 | 0 | 6 | 5 |
| Additional Android | 28 | 8 | 0 | 0 | 20 |

All54 available-reference cases aligned. Among those, only34 have an explicit
photo stamp label:3 present and31 absent. Two present and6 absent were correctly
classified;26 remained unreadable, with no wrong explicit decisions in this
small diagnostic. The other20 prior Android photos have no explicit stamp label
and are not counted as accuracy evidence. The six successful scanner absences
include Reckoner's Bargain and Patchwork Automaton, using their verified original
references. This does not yet prove that retrieval chooses those references.

The original four synthetic guards passed. Summary and per-photo outcomes are in
`tools/acquisition-eval/printing-evidence-results.json`; private aligned images
remain local. There is no deployed stamp classifier or broad accuracy claim.

## Completed reference snapshot and actual-candidate evaluation

The downloader completed all112,472 downloadable faces;899 provider-unavailable
faces remain explicit. Snapshot SHA256 is
`2270183b7aedb66e4b0ec5d1dc1b3576d1ad643d1b12e310d0c863ba114ea748`.
Fourteen newly available public reference footers were inspected independently
and annotated ABSENT, bringing hash-bound public annotations to64. All68 private
photos now have their labelled reference available and all68 align.

The complete-snapshot stage isolation produced2 PRESENT,7 scanner ABSENT and1
additional-phone ABSENT. Among48 explicitly labelled photos (3 present/45 absent),
2 positives and8 negatives are correct,38 remain unreadable and no explicit
decision is wrong. The other20 photos have unlabelled stamp ground truth. This
is still stage isolation, with limited coverage; it does not establish reliable
future-batch confirmation. The Timberland Ancient photo's score remains below
the existing presence threshold and therefore unreadable. The threshold was not
lowered. The earlier partial-snapshot numbers above remain historical.

`evaluate_printing_candidates.py` now accepts the actual top candidates from
`catalog_compare.py`, binds the retrieval report/index/snapshot/photo manifests,
and verifies their hashes. Labels are consulted only after candidate evidence
is generated. It reports stamp agreement, contradiction or unresolved evidence
for each candidate, and conflicting observations remain unreadable. Agreement
never becomes exact-print confirmation. Six model-free guards pass, including
label-independent candidate selection and unknown/contradictory stamp handling.

Actual full-catalog candidate runs are pending the complete DINOv2/VGG16 indexes;
the helper's unit checks do not substitute for those measurements. Example with
read-only input mounts and a separate writable output directory:

```text
python /eval/evaluate_printing_candidates.py --manifest /eval/scanner-manifest.json --photos /photos --references /references --snapshot /references/snapshot.json --retrieval /retrieval/report.json --index /index/index.json --method visual --output /output
```

## Required before deployment

1. Complete the full reference corpus and compare image/OCR retrieval. Candidate
   selection must then come from actual retrieval, never the labels.
2. Test original/List counterpart references, misleading lookalikes, shadows,
   blur, glare, clipping and registration failure; include new stamped examples.
3. Measure false PRESENT and false ABSENT separately, with unreadable coverage.
   Do not lower thresholds merely to increase automatic confirmations.
4. Integrate immutable evidence, visible diagnostics, versioned persistent public
   assets and conservative printing decisions. Preserve human reviews and
   explicit Inventory commit. Verify batch/restart/resource behavior locally.

No production changes or merge approval are implied by this experiment.
