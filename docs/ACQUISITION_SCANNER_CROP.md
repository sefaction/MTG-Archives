# Preserve tightly framed scanner images

Tracking: #469 within #306/#463. Local scanner development evaluation, September 28.

## Failure and change

The 17 supplied scanner JPEGs already fill nearly the entire image. The previous
contour detector selected an internal printed frame, cutting off the lower
set/collector strip. Sunblade Samurai NEO 39 is a clear reproduction: the
selected polygon ended above `039/302` and `NEO EN`.

The detector now checks for a supported tightly framed image before choosing a
perspective crop. It requires all of:

- Short/long image aspect ratio between 0.68 and 0.76.
- At least 85% dark pixels (gray below 70) in each outer 1% strip.
- Large connected visible content after bounded morphology, with convex-hull
  area at least 70% of the image and bounding-box area at least 75%.
- Content rectangularity at least 88%, reaching within 14% of each image edge.

These are conservative heuristics, not a learned card detector or proof of one
physical card. Aspect ratio alone never selects the path. Blank images, a small
card on a dark background and a bright tabletop do not pass the fixture guards.
White-border, borderless or heavily skewed scans are not established by this
batch; they retain ordinary detection. A dark non-card rectangle may still
produce a geometric proposal, so geometry grants no identity/commit authority.

For qualifying images, the source quad is the four image corners: no source edge
is trimmed. OCR still receives an oriented/resized 1000 by 1397 image and reads
both portrait directions. Ordinary photo geometry and exact-print acceptance
rules are unchanged. The review view says **Full image retained; no crop** and
offers **Full card image** and reading zones. It reconstructs a display preview;
the saved original remains untouched. The native descriptor includes the
geometry source hash, so unreviewed work gets versioned processing. Saved human
reviews and Inventory are not rewritten.

## Measured result

Labels were read from the original scans independently, then cross-checked
against the frozen full metadata catalog (118,404 records, 109,269 paper cards).
Condition/finish were not inferred. These are development samples from one set;
scanner model/settings and physical overlap with phone photos are unknown.

| Original-byte scanner evaluation | Previous crop | Full image |
| --- | ---: | ---: |
| Expected card name proposed | 17/17 | 17/17 |
| Exact printing first | 8/17 | 15/17 |
| Exact printing among first 12 | 15/17 | 17/17 |
| Correct strong proposals | 0/17 | 11/17 |
| Wrong strong proposals observed | 0 | 0 |

Reckoner's Bargain and Patchwork Automaton still rank their List counterparts
first and originals second. Both remain review-only: printed set/collector text
cannot resolve the stamp. The full-image change does not implement stamp, set
symbol or artwork recognition, external lookup, or general scanner acceptance.

All 17 scans retained every edge at all four pixel orientations (68 geometry
checks). All 51 phone images in the supplied folder retained byte-identical
crops and geometry evidence in four orientations (204 comparisons). The latter
is a geometry regression check, not a new OCR accuracy measurement. An early
variant tied to the selected inner contour missed sideways cases; the final
connected-content check corrects those cases.

Four synthetic geometry tests, bounded review-evidence tests and the 656-test
unit suite passed. The local browser fixture uploads Sunblade Samurai, Island
and Thousand-Faced Shadow through the real preparation/recognition workers,
checks the exact printing and footer evidence, reloads full-image diagnostics,
and checks desktop/320px layouts with zero Inventory writes. It prioritizes only
its disposable fixture jobs ahead of pre-existing model-upgrade work; its timing
is not queue throughput evidence. The first browser attempt had invalid fixture
storage JSON (missing `sections`), failed before upload, and was corrected.

Inference uses the existing offline CPU image/models, without a new download.
Raw timings are recorded for reproducibility but the laptop also ran other local
work; they do not establish a speed comparison or production load gate.

## Reproduce

Private originals and outputs remain outside Git/images. The checked-in
`scanner-manifest.json` records independent identities and original hashes;
`scanner-results.json` records sanitized baseline/final metrics and source hashes.

```powershell
python tools/acquisition-eval/rotation_matrix.py --originals-only --photos C:/path/to/scans --manifest tools/acquisition-eval/scanner-manifest.json --models C:/path/to/acquisition-models --output .local-data/scanner-current
npx tsx scripts/benchmark-acquisition-recognition.ts --catalog .local-data/acquisition-corpus/scryfall-default.jsonl.gz --manifest tools/acquisition-eval/scanner-manifest.json --ocr .local-data/scanner-current/report.json --fixture original --output .local-data/scanner-current/resolution.json
```

The helper optionally accepts `--geometry` for an isolated source override.
For geometry guards, use the recognition image with `tools/acquisition-eval`
mounted at `/eval` and run `python -m unittest discover -s /eval -p test_geometry.py`.
CI runs those same model-free tests with pinned geometry dependencies.

```powershell
$env:MTG_LOCAL_PILOT_TEST='1'
$env:MTG_ACQUISITION_SCANNER_PATH='C:/path/to/scans'
npx playwright test tests/ui/acquisition-scanner-crop.spec.ts --project=chromium
```

No schema, Compose, environment or production operation is part of this change.
