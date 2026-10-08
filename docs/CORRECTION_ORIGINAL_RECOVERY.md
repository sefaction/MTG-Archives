# Correction-original read recovery

Issue #670 reproduces a transient original-photo read failure in Correction photos. The former Retry action refreshed the library and closed the selected photo, without making a second original request.

The original viewer now owns its loading/error state. Retry original issues a fresh request while retaining the selected example and library page. A failed retry remains recoverable; a successful read clears its error. Hiding the original or switching examples, owners or pages unmounts the viewer and discards that read error. Original requests continue through the existing owner/Admin Mode authorization and private no-store endpoint.

This change affects display recovery only. It changes no correction labels, sampling, storage allowance, recognition policy, server permissions or Inventory behavior.

The focused browser regression uses an owned local account and controlled list/photo transport responses. It exercises repeated read failures, successful retry, no list refetch or mutation, hiding a failed view, and desktop/phone overflow. The original implementation failed at the second-photo-request assertion. This qualifies transport recovery, not independent recognition accuracy. 

## Qualification

- Full application core verification: 841 tests, zero failures/skips, typecheck, production build and thirteen client manifests passed. Final browser-fixture typecheck also passed.
- Required Windows scanner installer 0.4.3 checksum verified and Docker production build passed. Running web image `0133aa59dbdf64f0b305774dd966a0290ac93549455fdfb45bf7b87bb953f614` matches 586 application inputs at digest `10b0457f20a901e6dac022890e190a82f1158c527eab984ad72aca10ed226217`.
- Focused retry browser checks passed at 1366px and 320px; successful-original screenshots were inspected. The existing real correction draft/lost-acknowledgement/private-library/original/withdrawal/removal workflow also passed against this image.
- Original source-row projections are conserved, owned fixtures were cleaned, and all twelve other local services retain their exact image/lifecycle/mounts/limits. The three native services still match all 302 shared library/script/schema inputs.

The initial fixture alert locator matched the Next.js announcer as well as the intended error; it was scoped before recording the failing original-request assertion. A malformed tiny image asset was replaced with a generated PNG before success qualification. The first post-load browser run began while web startup was incomplete and failed at login; after healthy status and host HTTP200 were verified, the unchanged suite passed. Those failures remain distinct from the successful results. No production deployment or physical scanner operation occurred.
