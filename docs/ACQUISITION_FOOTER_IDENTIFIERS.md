# Interpreting split scanner footer text

## Scope

The local resolver and external catalog lookup now use the same bounded footer
parser. It can read a collector number on its own line when that orientation also
contains a printed set/language marker, and a punctuated set marker whose language
is joined to the artist name. It preserves zero-padding normalization and identity
suffixes, retains conflicting readings, and rejects bare unmarked copyright years.
A copyright such as `C1993-2008 Wizards ... 203/301` supplies collector203 rather
than a fabricated rarity-C collector1993. No title/footer evidence is combined
across orientations. External extraction remains independent of the local set list.

Recovered layouts remain review-only. They cannot expand strong automatic matches;
image/text union and the live hybrid profile still disable automatic confirmation.
Stamp uncertainty, saved corrections, owner/capacity guards and explicit Inventory
commit retain their existing behavior. No localization, OCR region, model, visual
retrieval, native stamp threshold or image processing changes are included.

## Durable version

The parser is `footer-identifiers-v1`; catalog reconciliation is
`catalog-reconciliation-footer-layout-v6`. A new metadata interpretation consumes
the existing immutable OCR and image observations. It does not rerun OCR just to
interpret split lines. Eligible unreviewed results can refresh; saved human review
and completed native jobs remain unchanged. Missing or obsolete resolver versions
are superseded before catalog provider calls. New raw outputs and reconciled
outputs record the parser version, while historical outputs remain readable.

## Paired development evidence

Original hashes, labels, catalog snapshots and native outputs were held fixed.
The newer67 replay used actual previously retrieved printing observations; newly
introduced candidates without such observations are explicitly unobserved. The
older123 replay likewise reused its actual native printing report. Earlier68
image/text results are reported separately, since their reference-directed stamp
experiments cannot establish full printing-stage accuracy.

| Saved development set | First before | First after | Expected printing offered |
| --- | ---: | ---: | ---: |
| 67 playable scans | 63 | 67 | 65 → 67 |
| 123 labelled older scans | 120 | 120 | 123 → 123 |
| 23 Android photos, image/text only | 14 | 14 | 21 → 21 |
| 17 scanner exports, image/text only | 15 | 15 | 17 → 17 |
| 28 additional photos, image/text only | 26 | 26 | 27 → 27 |

The four improved newer scans are Blackblade Reforged DMC178, Commander's Sphere
DMC181 and ONC128, and Island EOE263. No previously correct first choice regresses
in these paired sets. Older Boggart Ram-Gang remains second with unreadable stamp
evidence. One unresolved older playtest is excluded. Original files, labels and all
prior reports remain private and unchanged; a sanitized summary is in
`tools/acquisition-eval/footer-identifiers-results.json`.

These are development samples, with repeated printings and unknown physical-copy
grouping. The result is not independent accuracy, calibrated confidence, automatic
precision or throughput. Fresh final-evaluation material remains requested and
must be reserved from tuning. Recognition #463 remains open and incomplete.

## Verification and local review

Focused footer, recognition, catalog, printing and visual guards passed, along
with TypeScript and ESLint. The disposable PostgreSQL/core helper passed in156.2s
and cleaned its owned database/volume. It exercises missing-local-set fallback
from split footer evidence, rejects old interpretations before provider IO, and
preserves native output and Inventory. An immediate fixture claim initially failed
because PostgreSQL timestamp(3) rounds while JavaScript dates truncate; the fixture
clock allows that one millisecond. The production queue and its timing are unchanged.

Final cumulative Docker and four-original browser acceptance are pending. The
new real-worker case uses normal upload and queue availability, preserves declared
Card scan geometry, checks the recovered first printing and versioned evidence,
keeps human review null, verifies zero Inventory writes and checks desktop/320px
layouts. Simple/Advanced remains a separate sibling UI PR, included only in local
cumulative testing. Scanner qualification remains separate; production and physical
hardware are unchanged. Individual PR approval is required before merge.
