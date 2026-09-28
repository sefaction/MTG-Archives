# Card reading direction

Tracking: #465, within detection #306 and recognition #307. The wider recognition
method/printing work remains #463.

## Failure and correction

EXIF orientation describes how the phone wants its photograph displayed. A card
can still be sideways or upside down inside that correctly displayed photograph.
The geometric crop puts the short edge across the top, leaving two possible
reading directions. The previous runtime read only one and disabled Paddle's
orientation classifiers. A four-photo reproduction retrieved all four expected
printings at 0/90 degrees and none at 180/270 degrees.

The native worker now reads title/footer regions from both 0 and 180 degrees of
the portrait crop. Each observation retains its own text, polygons and rotation
relative to the crop. It does not infer direction from a single OCR confidence
score. No new models, network inference or production configuration are needed.

Nearby OCR fragments on the same printed line are joined using their polygons;
this restores names such as `Saber` + `Ants` and collector text such as `L` +
`0304`. Separated rows and distant symbols stay separate. Original OCR polygons
remain available as evidence. If the first contour pass cannot locate a card,
bounded quarter-turn retries run before returning NEEDS_CROP, with accepted
corners mapped back into the original photograph's coordinate system.

The catalog resolver handles those observations independently:

- Exact name/printed-identifier evidence can select the supported direction.
- If neither direction has that evidence, fuzzy candidates remain review-only.
- Plausible evidence in both directions requires review, including when one
  direction alone would have automatically confirmed. The UI explains this.
- Text from opposite directions is never combined into an exact-print claim.
- List ambiguity, language, printing and user-default checks remain required.

Resolver version 4 prevents older completed evidence from newly auto-confirming.
Unreviewed photos get new jobs; existing saved decisions and Inventory remain
intact. Stamp detection and full-catalog visual retrieval remain separate work.
Cards whose outline remains unresolved after the bounded retries need review or
a better photograph.

## Development evidence, September 28

The same 23 labelled Android originals were used for each row below, against
the actual local Card projection. Rotated derivatives are not independent samples.

| Input | Exact printing first | Exact printing in first 12 | Strong proposals | Wrong strong proposals |
| --- | ---: | ---: | ---: | ---: |
| Unchanged originals | 15/23 | 21/23 | 8 | 0 |
| JPEG95, 0 degrees | 14/23 | 20/23 | 7 | 0 |
| JPEG95, 90 degrees clockwise | 16/23 | 21/23 | 10 | 0 |
| JPEG95, 180 degrees | 15/23 | 21/23 | 8 | 0 |
| JPEG95, 270 degrees clockwise | 16/23 | 21/23 | 9 | 0 |
| Counter-rotated pixels with EXIF6 | 15/23 | 21/23 | 8 | 0 |

The pre-change unchanged-original baseline was10/23 first,16/23 in twelve and
three correct strong proposals. The new unchanged-original results preserve all
previously retrieved expected printings. The JPEG95 zero-degree control loses
the exact Island candidate after re-encoding; the original and other orientations
retain it. Both Winter photos still fail outline detection. No result here proves
general automatic-accept precision or completes #463.

To avoid repeating expensive OCR when only deterministic line assembly changed,
the138-case matrix combines replay of saved raw OCR polygons with final native
reruns for all24 cases of the four photos affected by contour retries. Derivative
byte digests match exactly. Final-worker browser checks are separate. Private
reports retain this provenance; `tools/acquisition-eval/orientation-results.json`
contains the non-image summary. Originals/models/private observations remain
outside Git and disposable images.

## Reproduce locally

The opt-in helper checks original hashes, creates rotations only in memory, and
runs inference offline with one CPU and 2 GiB. It includes unchanged originals,
identically encoded JPEG95 controls at 0/90/180/270 degrees, and EXIF orientation6
with counter-rotated stored pixels. These are related derivatives, not additional
independent accuracy samples. Native response size and per-photo wait are bounded.

```powershell
python tools/acquisition-eval/rotation_matrix.py --photos C:/path/to/private/originals --manifest tools/acquisition-eval/android-expanded-manifest.json --models C:/path/to/persistent/acquisition-models --output .local-data/acquisition-corpus/orientation-current
npx tsx scripts/benchmark-acquisition-recognition.ts --catalog .local-data/acquisition-corpus/scryfall-default.jsonl.gz --manifest tools/acquisition-eval/android-expanded-manifest.json --ocr .local-data/acquisition-corpus/orientation-current/report.json --fixture pixels-270 --output .local-data/acquisition-corpus/orientation-current/pixels-270-resolved.json
```

Use `--runtime tools/acquisition-runtime` for a local native source override.
The scorer can select any named fixture; it uses the checked catalog digest and
labelled source-photo identity. Keep originals, model files, observations and
derivatives private and outside disposable images.

For the actual upload/review/Inventory path in local Docker:

```powershell
$env:MTG_LOCAL_PILOT_TEST = '1'
$env:MTG_ACQUISITION_CORPUS_PATH = 'C:/path/to/private/originals'
$env:MTG_ACQUISITION_RECOGNITION_TEST = '1'
$env:MTG_ACQUISITION_ROTATION_TEST = '1'
npx playwright test tests/ui/acquisition-photo-intake.spec.ts --project chromium
```

This fixture applies mixed quarter turns to the ten original labelled photos,
then checks exact printing candidates, all automatic choices, stamped-card
review, saved corrections and duplicate-safe explicit Inventory commit. It does
not claim an actual Android camera or unseen-photo acceptance test.
