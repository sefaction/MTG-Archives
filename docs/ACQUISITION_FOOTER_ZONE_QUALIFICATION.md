# Footer reading-zone comparison

## Change and boundary

PR #487 addresses flavor/body text entering the OCR footer. The canonical title
remains y0–250 on a 1000×1397 card. The footer now attempts y1270–1397 rather
than y1210–1397. A larger white stitch gap preserves the prior 457-row detector
canvas, preventing title sampling from changing when the footer shrinks.
Boxes crossing the gap or outside the attempted strips are rejected. Results
save the attempted zones; Advanced review overlays those actual zones. Historical
observations retain their original wider overlay.

Original pixels, localization, card-scan input, image retrieval, stamp checks,
printing policy and Inventory operations are unchanged. This narrower strip is
not a guarantee that every card frame excludes all body or power/toughness text.

## Development evidence

All 259 saved inputs completed native OCR in a serial, offline, one-CPU/2-GiB
container. Original bytes and source manifests were hash-verified before input.
Descriptor: `068e9306ca690ac6070d497bb34aae0e7c820fdecd1eda08270327d21c62ce5e`.
Frozen image observations were reused; where available, existing actual printing
observations were reapplied. New/unobserved printing candidates remain unknown;
no stamp evidence was fabricated.

| Saved sample | Comparison stage | First before → after | Expected printing offered before → after |
| --- | --- | --- | --- |
| 67 playable scans | Image/text union plus frozen printing observations | 61 → 61 | 65 → 65 |
| 23 Android photos | Image/text union | 14 → 14 | 21 → 21 |
| 17 scanner images | Image/text union | 15 → 15 | 17 → 17 |
| 28 additional photos | Image/text union | 27 → 26 | 27 → 27 |
| 123 labelled older scans, plus one unresolved | Image/text union | 114 → 115 | 123 → 123 |
| Same 123 older scans | Union plus frozen printing observations | 119 → 120 | 123 → 123 |

The 67-playable proposal ranks are unchanged for every input. Readable set/language
observations increase from42 to45 and collector observations from49 to53.
The FIN304 regression case now explicitly reads FIN/EN as well as collector304.
The additional-photo regression is a Satyr Enchanter original/List tie after
M19/EN becomes readable; the expected printing is still offered. That comparison
is union-only, not a new final printing-stage or automatic-confirmation result.

These are development comparisons, not held-out accuracy estimates. Repeated
printings, unknown physical-copy grouping, prior tuning and revised older labels
limit independence. Existing hybrid automatic confirmation remains off. Runtime
overlapped other local work and is not isolated throughput evidence. All original
files, labels and raw results remain private and unchanged.

## Rejected prototype

A first prototype shrank the detector canvas along with the footer. It preserved
the67-playable totals but regressed an Android title. It was not loaded or accepted.
The padded implementation preserves the prior canvas and restores that Android
result. Prototype reports are retained separately.

## Acceptance gates

Five Python reading/geometry guards and20 focused TypeScript recognition/review/
job-generation guards passed. Footer-only typecheck/ESLint and disposable database/
core verification passed (160.5seconds; owned fixture cleaned). The cumulative
Docker build matches 455 source inputs (digest `161ff30285cfcc06d9140544fd3e452f43b423480edf4f35632aef18859039c5`);
native descriptor matches the comparison above. The corrected five-photo browser
case passed 1/1 in 10.5minutes through the normal shared queue, including actual
saved zones, FIN304 evidence, full-frame scans, desktop/phone layouts and the
separate Simple/Advanced UI batch #488. An initial browser assertion omitted
scrolling to an intentionally lazy row; its correction and retained results are
documented in the PR/checkpoint. Original images and painted previews were checked.
Confirmation made zero Inventory writes and the owned fixture was cleaned.
This change does not close #463.
