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

At the user's direction the new 90-file preserved sample is evaluated only on
67 playable cards, including four visible stamps; 23 art cards are excluded.
Visible labels were frozen before scoring. Same-printing repeats remain and
physical-copy grouping is unknown. The initial OCR-only stage offered 63 card
names and 53 expected printings, with 47 correct first printings among 67; 25 raw
strict-text proposals were correct. These raw proposals have not been promoted
to automatic confirmation in the local hybrid test profile.

The complete initial paired runtime evaluation scored all 67: 58 correct first
printings, 65 expected printings offered, four of four positive stamps observed,
and all 63 negative stamps unreadable. All four positive cases had UNKNOWN
reference stamp states: detecting the physical mark did not prove a printing's
relationship to it. Two PLST identities ranked first and two remained alternatives.
No proposal was eligible for automatic confirmation.

Native mean times were 4.593 seconds OCR, 9.813 seconds visual and 7.584 seconds
printing. These overlap older queued batches, builds, and temporarily two local
printing replicas (each 1 CPU/1 GiB); they exclude queue/provider waits and must
not be summed into isolated throughput. OCR used 1 CPU/2 GiB and visual 1 CPU/3 GiB.

The subsequent partial-identifier tie fix is a development replay: 61 first,
65 offered on the same frozen native observations. It reproduces all initial
live proposal orders under the earlier policy, and every replay candidate has
actual native printing evidence. It changes three Mountain results covering two
printings, not three proven independent physical trials. See
[the bounded correction](ACQUISITION_BASIC_LAND_EVIDENCE.md) and the sanitized
[complete results](../tools/acquisition-eval/playable-runtime-results.json).

Four model-free guards verify uncertainty, partial-result refusal, changed
generation/photo/labels/full-frame mode, identity reorder and duplicate bytes.
The complete paired playable runtime results pass the scorer without partial
mode. Original photos, frozen labels and results
are retained privately. Production and scanner hardware are unchanged.
