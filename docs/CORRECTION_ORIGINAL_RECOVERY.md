# Correction-original read recovery

Issue #670 reproduces a transient original-photo read failure in Correction photos. The former Retry action refreshed the library and closed the selected photo, without making a second original request.

The original viewer now owns its loading/error state. Retry original issues a fresh request while retaining the selected example and library page. A failed retry remains recoverable; a successful read clears its error. Hiding the original or switching examples, owners or pages unmounts the viewer and discards that read error. Original requests continue through the existing owner/Admin Mode authorization and private no-store endpoint.

This change affects display recovery only. It changes no correction labels, sampling, storage allowance, recognition policy, server permissions or Inventory behavior.

The focused browser regression uses an owned local account and controlled list/photo transport responses. It exercises repeated read failures, successful retry, no list refetch or mutation, hiding a failed view, and desktop/phone overflow. The original implementation failed at the second-photo-request assertion. This qualifies transport recovery, not independent recognition accuracy. Final qualification and local build identity will be recorded after the checks finish.
