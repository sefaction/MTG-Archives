# Local acquisition recognition evaluation

This is an **offline development benchmark**, not the application's recognition
worker or an automatic acceptance policy. Original photos, downloaded catalog
data, model files, OCR output and crops belong under ignored `.local-data/`.
The checked-in manifest contains hashes and independently read card labels only.

## Corrected labels and expanded comparison

The original label audit missed visible Planeswalker stamps on **Krosan Vorine,
Saber Ants and Timberland Ancient**. Their expected identities are PLST LGN-131,
PLST MMQ-267 and PLST MOM-210. The historical table and `development-results.json`
below used incorrect original-print labels; preserve them as historical output,
not current accuracy evidence. The initial four-correct-automatic-match claim is
also withdrawn: Timberland Ancient was one wrong automatic choice. Corrected
manifests and the expanded comparison distinguish names from exact printings.

See [the method comparison](../../docs/ACQUISITION_RECOGNITION_COMPARISON.md) and
`expanded-results.json` for the current 23-photo evidence and its limitations.

Quarter-turn and EXIF robustness checks are documented in
[Card reading direction](../../docs/ACQUISITION_ORIENTATION.md). Use those for
rotation behaviour; recognition-method selection still follows the comparison.

### Reproduce the visual diagnostic

Prepare public references and official weights separately, with no private photo
mount. Images and weights are persisted under ignored `.local-data`, not baked
into the Docker image. Replace the photo path with the directory of originals
matching `android-expanded-manifest.json`.

```powershell
docker build -t mtg-acquisition-visual-eval:local -f tools/acquisition-eval/Dockerfile.visual tools/acquisition-eval
$evaluationRoot = (Resolve-Path tools/acquisition-eval).Path
$comparisonRoot = (Resolve-Path .local-data/acquisition-corpus/poor-20260927).Path
$photoRoot = 'C:/path/to/private/originals'
python tools/acquisition-eval/prepare_visual_references.py --catalog .local-data/acquisition-corpus/scryfall-default.jsonl.gz --manifest tools/acquisition-eval/android-expanded-manifest.json --output $comparisonRoot
New-Item -ItemType Directory -Force "$comparisonRoot/visual-models" | Out-Null
docker run --rm --memory 3g --mount "type=bind,source=$comparisonRoot/visual-models,target=/models" mtg-acquisition-visual-eval:local -c "from torchvision.models import vgg16,VGG16_Weights; vgg16(weights=VGG16_Weights.IMAGENET1K_V1)"
docker run --rm --network none --memory 3g --cpus 4 --mount "type=bind,source=$evaluationRoot,target=/eval,readonly" --mount "type=bind,source=$photoRoot,target=/photos,readonly" --mount "type=bind,source=$comparisonRoot,target=/data" --mount "type=bind,source=$comparisonRoot/visual-models,target=/models,readonly" mtg-acquisition-visual-eval:local /eval/visual_compare.py --references /data/reference-index.json --manifest /eval/android-expanded-manifest.json --photos /photos --output /data/visual
```

The reference preparer verifies the frozen catalog digest and retries only
missing downloads. Inference verifies all photo/reference digests, records model
and source hashes, and resumes a versioned reference index. It benchmarks pHash,
the MTG RealTime VGG16 feature method, and SIFT reranking; it does not run either
upstream application end to end. The VGG weights used here have SHA-256
`397923af8e79cdbb6a7127f12361acd7a2f83e06b05044ddf496e83de57a5bf0`.

Use `score_ocr.ts` to score saved OCR observations on that identical reference
pool. Pass the current resolver or export the frozen pre-guard revision for the
historical table; it is a pure module with no application side effects:

```powershell
$baselineResolver = git show 0e681f3feee2a59008f174f19ee003a5b23388f6:lib/acquisition-recognition.ts
[IO.File]::WriteAllText((Join-Path $comparisonRoot 'baseline-resolver.ts'), ($baselineResolver -join "`n"), [Text.UTF8Encoding]::new($false))
npx tsx tools/acquisition-eval/score_ocr.ts --resolver "$comparisonRoot/baseline-resolver.ts" --references "$comparisonRoot/reference-index.json" --manifest tools/acquisition-eval/android-expanded-manifest.json --ocr "$comparisonRoot/baseline.json" --output "$comparisonRoot/ocr-controlled.json"
```

`baseline.json` contains the current native Paddle worker's saved observations;
the Tesseract evaluator's `report.json` also works. The rejected larger-footer
experiment is not part of the runtime and its saved observations remain private.
No helper interprets nearest-neighbour rank as calibrated confidence.

## September 27 evidence and integration decision

Ten original Android photos from one capture session were visually labelled,
then their set/collector/name identities were cross-checked against the current
Scryfall default bulk file. The file contains 118,404 records, of which 109,269
are not marked digital. The app's existing Card cache had 17,953 records and
none of the ten exact sample printings. **The full bulk data was used only by
this benchmark; the app database has not yet been expanded.**

| CPU pipeline | Correct printing in first 12 proposals | Correct printing ranked first | Median / maximum photo processing | Peak process RSS |
| --- | --- | --- | --- | --- |
| OpenCV + Tesseract whole photo/title/footer | 8/10 | 8/10 | 1.526 / 1.756 s | 259 MiB |
| OpenCV + PaddleOCR whole card | 10/10 | 8/10 | 4.397 / 5.233 s | 1,098 MiB |
| OpenCV + PaddleOCR title/footer | 10/10 | 8/10 | 1.995 / 2.310 s | 732 MiB |

Each row is one serial run with Docker restricted to two CPUs; OCR used one
effective thread. Paddle whole-card initialization requested two threads but
the inherited OMP limit restricted it to one; the final region configuration
explicitly requests one. Times include image decoding/geometry and OCR, exclude
model startup, upload and catalog download. The title/footer process started in
about one second. Tesseract launches a bounded child per OCR pass; its table RSS
is parent peak and its report separately records child peak (not additive).
Versions, model hashes, source hashes and per-sample ranks are recorded in
`development-results.json`. The two OpenCV distributions differ between the
Tesseract and Paddle environments; the Python geometry source is the same for
the final comparison. This is a pipeline comparison, not an isolated engine
accuracy experiment.

**Starting integration choice:** the Paddle title/footer CPU path, with an
isolated memory budget and one concurrent image. Keep Tesseract as a measured
baseline. Every proposed printing requires human review; finish and condition
remain UNKNOWN. A name alone never proves printing identity. The two second-
rank cases and any OCR contradictions must remain visible to the reviewer.

All ten photos also passed the actual local app's authenticated photo-library
upload, atomic file storage and Sharp preparation worker in a disposable owner
fixture. The browser run passed 1/1 in 19.5 s; the ten-photo upload-to-prepared
interval was 8.602 s. Exact original hashes survived, no retention date was set,
and Inventory was unchanged. That app test **does not run OCR yet**.

## Limits

- All ten samples were used during development. There is no held-out accuracy
  claim, no automatic acceptance and no measurable automatic-accept precision
  (zero denominator).
- Initial geometry selected an internal text box on one photo. The revised
  convex-hull/tabletop proposals corrected that observed error. Rectangles are
  not card identity or physical-count evidence. Manual crop recovery, rotated
  image coverage, multi-card detection and card-trained detection comparison
  remain P4 work.
- Larger/sleeved/glare/non-English/DFC/noncard corpora, visual/local-feature and
  embedding comparisons remain P5 gates. No GPU or scanner hardware was tested.
- This does not complete catalog maintenance, application recognition/review,
  Inventory commit, backup/restore or actual Android HTTPS camera acceptance.

## Reproduce

Build from the worktree. Bootstrap public Paddle model files with **no private
photo mount**, then run image inference with `--network none`. Use an empty,
separate output folder to retain each experiment. Example PowerShell paths
below resolve only within this worktree; original photos are read-only mounts.

```powershell
docker build -t mtg-acquisition-eval:local tools/acquisition-eval
docker build -t mtg-acquisition-paddle-eval:local -f tools/acquisition-eval/Dockerfile.paddle tools/acquisition-eval
$corpusRoot = (Resolve-Path .local-data/acquisition-corpus).Path
docker run --rm --memory 2g --cpus 2 --mount "type=bind,source=$corpusRoot/paddle-models,target=/models" mtg-acquisition-paddle-eval:local --bootstrap
docker run --rm --network none --memory 2g --cpus 2 --read-only --tmpfs /tmp:rw,size=256m --mount "type=bind,source=$corpusRoot/paddle-models,target=/models" --mount "type=bind,source=$corpusRoot/android-20260927,target=/input,readonly" --mount "type=bind,source=$corpusRoot/paddle-regions-v1,target=/output" mtg-acquisition-paddle-eval:local --input /input --output /output --regions
npx tsx scripts/benchmark-acquisition-recognition.ts --catalog .local-data/acquisition-corpus/scryfall-default.jsonl.gz --manifest tools/acquisition-eval/android-manifest.json --ocr .local-data/acquisition-corpus/paddle-regions-v1/report.json --output .local-data/acquisition-corpus/paddle-regions-v1/resolution.json
```

The comparison command requires the exact manifest corpus hashes and catalog
digest; missing/changed inputs fail. `--regions` can be omitted for whole-card
Paddle. The Tesseract image has the same input/output arguments and no model
mount. Requested private benchmarks are not silently skipped in CI: they are
explicitly separate from ordinary unit tests and require private assets.

To repeat real-photo ingestion against the local snapshot:

```powershell
$env:MTG_LOCAL_PILOT_TEST='1'
$env:MTG_ACQUISITION_CORPUS_PATH=(Resolve-Path .local-data/acquisition-corpus/android-20260927).Path
npx playwright test tests/ui/acquisition-photo-intake.spec.ts --project=chromium
```

The browser fixture verifies the manifest hashes, creates its own user/location,
and removes only its generated session rows/files. Originals remain untouched.

## Sources and artifacts

- [Tesseract quality and segmentation guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html)
- [OpenCV contours](https://docs.opencv.org/4.13.0/dd/d49/tutorial_py_contour_features.html) and [perspective transforms](https://docs.opencv.org/4.13.0/da/d54/group__imgproc__transform.html)
- [PaddleOCR quick start](https://www.paddleocr.ai/main/en/quick_start.html)
- [OpenCV license](https://opencv.org/license/) and [PaddleOCR license](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE): Apache 2.0. The downloaded official detection/English recognition model cards also declare Apache 2.0; their README hashes are in the result artifact. Tesseract is Apache 2.0; runtime and English data hashes are recorded.
- [Scryfall default bulk metadata](https://api.scryfall.com/bulk-data/default_cards), retrieved September 27: `jsonl_download_uri` and `compressed_size` are the observed current fields. The 78,601,348-byte gzip contains JSONL, not a top-level JSON array. A future loader must validate the returned format and use the existing Card normalization, preserving IDs and references.

Library/model licenses do not grant rights to redistribute card artwork or the
private photographs. This repository contains no photos, catalog dump or weights.
