# Public inventory navigation and wishlist responsiveness

Issues: #663, #664 and the discovered phone layout bug #666. The user confirmed both navigation/card paths into Trades and wishlisting a Public inventory card.

## Reproduction and cause

On the approved main1800db5 cumulative Docker app, Public→Trades client navigation exceeded the10-second assertion although direct authenticated Trades HTML returned200 in275–558ms and RSC in73–77ms. Wishlisting persisted exactly one row and returned successfully while the button remained Saving.... Neither original reproduction emitted browser page/console errors.

Public intentionally omits private storage locations from InventoryBrowser. The old destructured default created a new empty array on every render. Its synchronization effect then scheduled another state update on every render. A stable shared default stops that loop and preserves explicitly supplied storage locations.

The first fix independently passed navigation and released the save button, exposing stale card-panel feedback: it retained the pre-save selected row. The panel now displays the matching current result row, retaining its existing selection fallback when that row is absent. Interrupted wishlist requests previously raised an uncaught Failed to fetch error. The card forms now catch failures, display a bounded retry message, and release pending state; existing server authorization and idempotent upsert remain authoritative.

Phone visual inspection separately found title/action layout overflow. The modal overflow assertion failed on the previous production image. The header now stacks below the small-screen breakpoint and wraps its title; desktop keeps the row layout. The final320px screenshot and overflow assertion pass.

## Qualification

- Final feature typecheck PASS and835 automated tests PASS with zero failures/skips.
- Official cumulative Docker production build PASS, required scanner installer0.4.3 checksum gate PASS and all13 client manifests PASS.
- Final-image browser group:16/16 PASS in2.7minutes, serially. Fourteen cases cover1366px and320px repeated Public→Trades transitions, slow request navigation away, failed RSC/document fallback, normal wishlist save/update, request failure/retry, lost acknowledgement/retry with one saved row, disabled repeated submission, closing the panel while saving, refreshed quantities and horizontal modal bounds. Existing Public inventory parity and owner Inventory workspace checks also pass.
- Desktop and phone saved-quantity screenshots inspected. No uncaught browser errors; only explicitly injected network-failure console diagnostics are permitted in failure cases.
- Web healthy, HTTP200 and zero restarts. Only web replaced; all12 other service identities/start times/restart counts/mounts/limits conserved. All seven original full-row projections match after fixture cleanup. All1,092 originals/2,832,075,218bytes retain matching stored SHA256s.
- Exact final local web image:e4ddc79caa8502f26758d6a084629b742e3c7f9fcc5de327dc970a9fa5a2069e. All584 review inputs match digest8c23fe55b897987825aada11b8ce5fba9b99ad613f93c48c795745b2067bd998. OCR/visual/printing each match all301 shared library/script/schema inputs.

Cumulative source includes approved main1800db5, separately unapproved native diagnostic PR665/f37474b, and this Public inventory fix. No native runtime/model changes were required by this batch. Raw fixture traces and intermediate failures remain private under .local-data; interrupted exact owned fixtures were verified and cleaned. Test-only menu/hydration, heading and request-teardown mistakes were corrected without weakening the application checks. Current GitHub status is authoritative for publication and required checks.

## Delivery policy

Deliver one coherent PR for663/664/666. Keep these issues open until the individually approved fix merges. The user is unavailable overnight: continue authorized independent work and record consequential unanswered decisions in WORK_CHECKPOINT.md. New PRs require their own merge approval. No production operation, physical scanner feeding, Unraid capacity inspection or automatic-runner claim.