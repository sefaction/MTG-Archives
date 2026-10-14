# Scanner footer position guard

Issue: https://github.com/sefaction/MTG-Archives/issues/779
Parent: PR #771, `c95856055e958b05ff3ee3780382ae10b1bff406`.

A full-width supplemental footer can include the power/toughness box above the identifier line. On saved Great Oak Guardian (`test-scan.017.jpg`), OCR reads `47J` there, alongside the correct `170/302 U`. String-only recovery treats both as collectors.

The parser now uses boxes from the same complete orientation to exclude an isolated supplemental number only when all its matching boxes are entirely right of the existing left identifier region (x > 630), entirely above every supported explicit collector box, and those lower-left boxes agree on one collector. Each box must have four finite in-bounds points with positive width/height in the canonical 1000 × 1397 footer frame. An unspaced letter-number token cannot supply the explicit anchor because it may be a numeric set code.

Original OCR strings, polygons, scores, source readings and native output are unchanged. The guard affects the metadata interpretation used by both oriented recognition and catalogue lookup. Explicit fractions/rarity readings, primary/source isolated readings and cases without sufficient spatial support retain the previous interpretation. Each direction and each inferred/reference frame resolves separately. Any exclusion requires review; it cannot create automatic eligibility. Parser version is `footer-observations-v4`; resolver version is `spatial-footer-review-v12`.

## Completed verification

- All 299 acquisition regression tests pass, including supported exclusion; absent/conflicting/invalid/out-of-region boxes; duplicate text in different positions; explicit and older-layout identifiers; primary/source conservation; orientation and independent reference-frame separation; original-input immutability and catalogue-query parity.
- TypeScript check passes after adding the four-image browser regression.
- Paired pure resolver replay uses the same frozen public catalogue (`8b0ffaf2acc9312f864118446d318416d3649fb5c060c35cab5df5d7de54cc6e`) and the same 124 saved native outputs for both revisions. First-choice exact printing remains 115/123 in this primary-text-only diagnostic; automatic eligibility stays 51/124. No first-choice wins/losses or newly automatic outcomes occur. This is not the later combined visual/printing result.
- Only three observations change: 017 removes `47j` while retaining 170; 039 removes `4` while retaining 201; 115 removes `413` while retaining 253. The latter two stop reporting a collector conflict but remain review-required. Inspection of the original 039/115 images confirms right-side power/toughness boxes (2/3 and 4/5).
- Private replay report records source, public catalogue and all saved-output hashes in `.local-data/footer-position-frozen-replay-qualified.json`. Original private images are not committed.

## Actual local qualification — October 14

The exclusive review gate is cleared. The cumulative review source preserves all later correction, printing and snapshot diagnostics/fixture changes, with this PR's three application files and final browser assertions applied. A diagnostic-helper merge conflict was resolved using the exact later qualified file; the footer implementation remains intact.

All three required-installer/application, OCR and visual image builds pass. Each image matches all 329 intended library/script inputs. The loaded web matches all 623 application inputs, digest `0c1b4c42cf5780a54e51e7bd073c4dc0e25d3f38dfc701a987b60403f21f47f2`. Six application roles were deliberately recreated; PostgreSQL identity and all storage/resource/command/environment values are preserved. All seven review services run. The 16 primary services retain their full identities, configuration and lifetimes, including three already stopped services.

The ordinary four-image native/printing/browser case passes in 2.1 minutes without skips/retries. Adding an explicit visible supplemental-footer assertion justified one strengthened run; it passes in 1.9 minutes, also without skips/retries. Both runs use the same saved 017/039/115 images and unchanged 020 control, comparing frozen original geometry, text, lines, orientations and zones and checking original/downloaded SHA hashes. All expected exact printing proposals remain first. The excluded readings remain in the native output and visible Additional footer reading section at 1366px and 320px; primary collector evidence is 170, 201, 253 and 190. Reviews/receipts remain absent, automatic acceptance remains false, and Inventory stays zero.

Native model descriptor `1cbcff958eb52b3848bc63e9946fbd37e573216651bbd5fe8f043ba5312aea2e` and catalogue `8b0ffaf2acc9312f864118446d318416d3649fb5c060c35cab5df5d7de54cc6e` remain. Each run completes all four canonical/OCR/visual/catalogue/printing stages; superseded optional reference work is not a failed job. Exact owned users, players, sessions, photos, correction accounts, Inventory, queued jobs and photo files are empty after cleanup. The pre-existing administrator/player remain.

Observed process peaks after both bounded runs: OCR 1,152,970,752 bytes / 2 GiB, visual 1,622,519,808 / 3 GiB and printing 1,011,920,896 / 1 GiB. Max-limit, OOM and restart events remain zero. OCR/visual swap peaks of 2,301,952 / 15,208,448 bytes remain; this is not a general no-pressure or sustained-throughput claim.

A first strict configuration comparison failed because environment/bind arrays changed order. Sanitized investigation confirms identical key/value sets, no duplicate environment keys, identical bind permutations and actual mounts, and unchanged CPU/memory limits. The original failure is retained; the corrected comparison sorts only these unordered collections and still checks every value and all other configuration fields. No service setting or product guard was changed to make the comparison pass. Earlier missing ignored-installer setup files and the mistaken no-anchor unit fixture remain disclosed.

Public qualification is in tools/acquisition-eval/scanner-footer-position-qualification.json. Private exact-source, replay, raw output, build/browser logs, strict-failure and conservation records remain in the owned cumulative .local-data folder. Final feature-head CI must be inspected after this qualification commit. Separate reviewer owns readiness, individual approval, merge and issue closure; no approval is inferred.

These are reused development scans. Independently labelled physical card edges and unseen exact printings are still needed to measure scanner accuracy near the user's target. This guard interprets observed footer placement; it does not establish a physical edge.
