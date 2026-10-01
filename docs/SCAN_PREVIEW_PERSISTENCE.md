# Scan preview persistence

The production-reported Your scan preview was discarded each time its review row
left the viewport. Returning downloaded the private original again (`no-store`),
so an already rendered preview depended on another successful transfer. Review
refreshes also recreated evidence objects and unnecessarily restarted rendering.

The preview now loads on first visibility and keeps its bounded display canvas
until the component is removed or its render inputs change. Identical geometry,
reading zones and observations do not trigger another download. Full-resolution
decoded input is released after rendering; only the bounded preview is retained.
An explicit Retry scan image button recovers an actual image load failure.
Original authorization, server retention, saved reviews and Inventory are unchanged.

## Validation

- A regression against the previous local image reproduced removal of the canvas
  when scrolling beyond the real viewport observer's margin.
- Desktop (1366px) and phone (390px) tests each completed three scroll-away/return
  cycles, including fresh equivalent review objects, with identical rendered pixels
  and one original download. Subsequent original downloads were deliberately made
  unavailable to prove the existing preview no longer depends on them.
- The phone test held the initial download, scrolled away, and then completed it.
- Advanced original/reading-zone switching and explicit retry after a controlled
  HTTP503 passed. Simple and Advanced scrolling preserved the full rendered pixel image. Both fixture owners retained zero Inventory entries and were removed. The existing fast-correction workflow also passed (3/3 focused checks).
- 760 automated tests, TypeScript and the production Docker build passed. The
  required full verification completed its core checks. Broad browser checks finished with 28 passes and 80 explicit skips after all nine initial failures passed on recheck. The first run overlapped Docker replacement. Follow-up is recorded
  in WORK_CHECKPOINT.md, including any interrupted or unrelated failures.

## Local review build

Based on merged main `6891f298157d6d6d126e2a3ba8e5d9af4ed2a731`, including the approved
scanner-framing and recognition-reuse work. Web, acquisition and catalog services use
`mtg-archives-web:scan-image-persistence`; existing native workers and data mounts
are retained. The existing verified Windows installer is included.

Image: `sha256:8efa5150456cd7961f7d2c4d7ccb16d33d86f9c15de8016fe1d4ad01dcb6aaec`.
All 506 build-input hashes match the host manifest:
`c492bc9e4b750aa6c3b69f3ed41021665596524ced23521f3a798cbb8094040d`.
Local HTTP login returned 200. Ignored review overlay:
primary checkout `.local-data/scan-image-persistence-review.yml`, appended to all
previous active Compose layers. Screenshots/logs are local test artifacts.

Issue #562 owns this narrow preview bug. No physical scanner operation or production update was performed. Existing user
reviews and Inventory were unchanged; only fixture reviews were saved and removed. The PR requires
individual approval before merge; production acceptance follows the operator update.
