# Scanner card framing

Issue #559: align the derived reading image to the complete physical card edges.
Original image bytes remain unchanged. Application acceptance uses the local Docker
app; production release parity has not been verified.

Padded black-bordered scans previously used the full scanner frame for fixed title
and footer zones. Gray backing and a missing leading edge could move the footer
outside its reading zone. `CARD_SCAN` now proposes the physical exterior dark rim
when all four straight sides have independent light-background support. It fits
the middle of each side, retains rounded corners and the entire observed dark rim,
and includes a small outward allowance for sampling/antialiasing. The derived
reading image remains 1000×1397; existing title 0–250 and footer 1270–1397 zones
are unchanged. Visual candidate retrieval uses the same proposed frame. Printing
and stamp registration continue to use the original bytes and their own alignment.

Three light margins plus an observed rim touching a source boundary indicate
clipping. Such scans expose `NEEDS_CROP / CLIPPED`, no title/footer readings or
reading-zone coordinates, and an instruction to adjust the scanner and rescan.
They cannot retry ordinary photo contours and select an internal printed frame.
Existing whole-photo visual retrieval remains available as review evidence.

Original and prepared views remain inspectable. Review evidence only exposes the
bounded geometry fields; framing never grants automatic acceptance. Current-job,
lease, generation, review and Inventory publication guards are unchanged.
Recognition routing, ranking, automatic confirmation and scanner-helper/native
settings-window work remain separate.

## Local acceptance — October 1, 2026

One operator-authorized fi-7160 feed produced one 1620×2160 PNG in 5046 ms.
The operator confirmed one undamaged card and an empty feeder/transport. The
manually saved profile was RGB, 600 DPI, simplex, 2.7×3.6 inches, Cropping=None,
Background=White. A controlled ADF(front) Sub offset of −0.5 mm, with Main and
magnification unchanged at zero, restored visible backing above the leading edge.
This is qualification of this sample, not a universal mechanical calibration.
The website requested 2.6×3.6; the returned 1620-pixel width shows that actual
driver output must be measured rather than inferred from the request label.

The original, helper manifest and ready upload receipt have identical SHA256
`db588adc1cddf7e3c711aaa749ed07cd21671fa4b93fc37dd976490cba4ba521`.
Four quarter turns all propose `scanner-card-edges / ALIGNED`. Independent maximum
gradient sampling in manually bounded straight-edge bands measured the following
outward allowance; this deliberately measures against a different reference from
the detector's dark-pixel threshold.

| Edge | Median source pixels | 95th percentile | Maximum |
| --- | ---: | ---: | ---: |
| Top | 0.82 | 0.82 | 0.82 |
| Right | 4.55 | 5.23 | 6.65 |
| Bottom | 3.89 | 4.30 | 7.12 |
| Left | 2.78 | 3.67 | 5.29 |

The maximum corresponds to less than five pixels in the normalized reading image.
Zero observed dark-border pixels lie outside the retained polygon. This is a
small outward margin, not mathematically zero error or proof about unseen pixels.
The four geometry calls took 146–199 ms while local workers were active; four calls
are development measurements, not a throughput distribution.

An isolated application test uploaded this complete original and the earlier
top-clipped original through the local library flow. It used ordinary admission,
real OCR/visual/catalog/printing workers and no priority overrides. Both originals
were downloadable with their exact hashes. The native and visual frames agreed;
candidate revisions were current, reviews and receipts remained null, automatic
acceptance stayed false and fixture Inventory contained zero items. Fixture records
and copied private files were removed after the test. No additional feed occurred.

| Local result | Complete original | Earlier clipped original |
| --- | --- | --- |
| Framing | ALIGNED | CLIPPED / NEEDS_CROP |
| Fixed OCR zones | Existing title/footer zones | Absent |
| Title | Blessing | Empty |
| Footer | Jason A. Engle; copyright and 8/249 | Empty |
| Collector evidence | 8 | Empty |
| Native elapsed | 4138 ms | 64 ms |

The two-input application test, including login, upload, admission, all stages,
download verification and desktop/phone checks, took 98.342 seconds before cleanup.
The actual physical batch also reached printing-check completion with Blessing
M14 #8 EN suggested, awaiting review and zero added. Set code/language were not
read from this older-style footer; stamp remained unreadable. These observations
do not establish recognition accuracy for a broader card population.

Acceptance verified rendered prepared pixels/reading zones and no horizontal page
overflow at 1366 and 320 pixels. Local checks: 15 geometry guards; 8 photo-input,
text and framing guards; 5 review-evidence guards; 759 application unit tests with
zero skips; typecheck; web build and client-manifest gates. The web build predates
the final Python-only shadow adjustment; native images were rebuilt afterward.

Running local web/acquisition/catalog source manifest (506 files):
`1fb182c76f5d23556dec48f0d2a22872378a9287d341865c1a48f7174c18b63e`.
Running OCR and visual `/eval/baseline.py` both match the final host source:
`f171e8fcf2bbad251de2c05a46e460068fa60b34c77fb915a92f32ef22799cc0`.
OCR `recognize.py`: `f137f04cfec43c4923530e174956a757026557d2cc20b20a07bbabf1459a3bed`.
The approved printing-reuse image remains loaded.

The first local visual build failed closed because Windows CRLF bytes changed the
unchanged encoder fingerprint. Rebuilding native tools with canonical repository
LF bytes restored index compatibility; the verified index/model identity check was
retained. The aborted fixture was removed and acceptance rerun with fresh inputs.
Do not modify the index fingerprint to accommodate a different query encoder.
Deterministic Windows build inputs and terminal-failure presentation are tracked
separately in #560.

## Qualification limits and recovery

This is a conservative heuristic for a dominant, nearly rectangular dark-bordered
card on light or shaded gray backing. It rejects weak contrast, multiple cards,
bent/noisy edges and an inner black rim surrounded by a distinguishable white
border. Indistinguishable pure-white backing/white borders, borderless cards and
other ambiguous inputs retain the existing full-frame/strip behavior. Their UI
explicitly says outer edges were not verified; this batch does not claim precise
alignment for them. Further qualification or manual framing is needed for those
inputs. Never claim all future cards fit perfectly from this one sample.

The scanner must capture every physical edge before software can align it. Preserve
the original, inspect the prepared view/reading zones, and obtain fresh one-card
loading/transport confirmation for every controlled feed. Leave the feeder empty
after qualification; do not automatically retry or restart retained production
connections. Upstream image integrity #557 and native settings-window crash #558
remain open. Production release parity remains unverified; no production deployment
or Inventory addition was part of acceptance.
