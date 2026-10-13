# Scanner footer position guard

Issue: https://github.com/sefaction/MTG-Archives/issues/779
Parent: PR #771, `c95856055e958b05ff3ee3780382ae10b1bff406`.

A full-width supplemental footer can include the power/toughness box above the identifier line. On saved Great Oak Guardian (`test-scan.017.jpg`), OCR reads `47J` there, alongside the correct `170/302 U`. String-only recovery treats both as collectors.

The parser now uses boxes from the same complete orientation to exclude an isolated supplemental number only when all its matching boxes are entirely right of the existing left identifier region (x > 630), entirely above every supported explicit collector box, and those lower-left boxes agree on one collector. Each box must have four finite in-bounds points with positive width/height in the canonical 1000 × 1397 footer frame. An unspaced letter-number token cannot supply the explicit anchor because it may be a numeric set code.

Original OCR strings, polygons, scores, source readings and native output are unchanged. The guard affects the metadata interpretation used by both oriented recognition and catalogue lookup. Explicit fractions/rarity readings, primary/source isolated readings and cases without sufficient spatial support retain the previous interpretation. Each direction and each inferred/reference frame resolves separately. Any exclusion requires review; it cannot create automatic eligibility. Parser version is `footer-observations-v4`; resolver version is `spatial-footer-review-v12`.

## Completed verification

- All 298 acquisition regression tests pass, including supported exclusion; absent/conflicting/invalid/out-of-region boxes; duplicate text in different positions; explicit and older-layout identifiers; primary/source conservation; orientation separation; original-input immutability and catalogue-query parity.
- TypeScript check passes after adding the four-image browser regression.
- Paired pure resolver replay uses the same frozen public catalogue (`8b0ffaf2acc9312f864118446d318416d3649fb5c060c35cab5df5d7de54cc6e`) and the same 124 saved native outputs for both revisions. First-choice exact printing remains 115/123 in this primary-text-only diagnostic; automatic eligibility stays 51/124. No first-choice wins/losses or newly automatic outcomes occur. This is not the later combined visual/printing result.
- Only three observations change: 017 removes `47j` while retaining 170; 039 removes `4` while retaining 201; 115 removes `413` while retaining 253. The latter two stop reporting a collector conflict but remain review-required. Inspection of the original 039/115 images confirms right-side power/toughness boxes (2/3 and 4/5).
- Private replay report records source, public catalogue and all saved-output hashes in `.local-data/footer-position-frozen-replay-qualified.json`. Original private images are not committed.

## Pending qualification

The shared local review lock is owned by another project worker (`1131126d-5082-4432-92df-b2eb5b43ff2d`, thread `01a10d58-d8a9-7432-8882-8aecd418b615`). This batch has not changed Docker, its databases, another worktree, or its lock. Local Docker/browser qualification is pending, and this draft must not be treated as ready.

Next: reconcile the latest cumulative review source and lock, integrate this exact scoped commit without overwriting other work, build the required application image, load it after confirming idle ownership, and run `tests/ui/acquisition-footer-position.spec.ts` on isolated review at 127.0.0.1:13011. The test uses actual saved 017/039/115 plus unchanged 020 control, exact original hashes/raw native fields, correct final printing, raw-noise visibility, manual/Inventory authority, desktop/320px and exact fixture cleanup. Retain failed invocations and check source/resource/service conservation before reporting a pass.

These are reused development scans. Independently labelled physical card edges and unseen exact printings are still needed to measure scanner accuracy near the user's target. This guard interprets observed footer placement; it does not establish a physical edge.
