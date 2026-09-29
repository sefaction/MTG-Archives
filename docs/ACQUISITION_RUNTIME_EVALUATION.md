# Score saved acquisition runtime results

This bounded helper scores actual saved OCR/image/catalog/printing results without
running recognition again. It supports issue #463's new-material evaluation.
It does not select an encoder, change thresholds or enable automatic confirmation.

```text
npx tsx scripts/score-acquisition-runtime.ts --manifest <private-frozen-labels.json> --provenance <private-native-versions.json> --results <private-result-directory> --output <score.json>
```

The manifest contains the frozen catalog SHA256, input kind and labelled entries:
file, original byte SHA256, category and (for PLAYABLE) expected Scryfall ID and
visible stamp state. ART_CARD entries are excluded. The provenance binds the
exact manifest bytes through `labelHash` and records the OCR, visual and printing
descriptors in `nativeVersions`. Source images and recognition outputs stay
private; labels never enter the recognizers or choose their candidate references.

The existing private collector saves one `<original-filename>.json` per completed
paired result, retaining native observations, source jobs, final proposals and
their local-to-Scryfall identity mapping. This scorer verifies image hashes,
native generations, full-frame Card scan behavior, proposal order/mapping,
printing membership and consistent reference coverage. It rejects changed or
duplicate sample bytes. Group repeated physical items before interpreting an
independent sample count; unique image bytes do not prove physical independence.

Default scoring fails if any playable result is missing. `--allow-partial` is
only for progress: it explicitly marks the report incomplete and lists missing
files. Never cite a partial score as the full batch's accuracy. Art cards do not
need runtime results to complete the playable evaluation.

The output includes first-choice/in-suggestions counts, correct/unreadable/wrong
stamp decisions, proposal eligibility, per-stage native timing and per-file
result hashes. It omits images, raw OCR, source job/owner IDs, local Card IDs and
private paths. A proposal's automatic eligibility is not a saved confirmation or
Inventory write. Native timings exclude queue/provider waits and may overlap
other local work; they are not isolated throughput measurements.

## Current new material

At the user's direction the new90-file preserved sample is evaluated only on
67 playable cards, including four visible stamps;23 art cards are excluded.
Visible labels were frozen before scoring. Same-printing repeats remain and
physical-copy grouping is unknown. The initial OCR-only stage offered63 card
names and53 expected printings, with47 correct first printings among67;25 raw
strict-text proposals were correct. These raw proposals have not been promoted
to automatic confirmation in the local hybrid test profile. The complete paired
image/catalog/printing evaluation is still running. No final accuracy claim.

Four model-free guards verify uncertainty, partial-result refusal, changed
generation/photo/labels/full-frame mode, identity reorder and duplicate bytes.
The actual first completed playable runtime results also pass the scorer; their
partial metrics are not acceptance. Original photos, frozen labels and results
are retained privately. Production and scanner hardware are unchanged.
