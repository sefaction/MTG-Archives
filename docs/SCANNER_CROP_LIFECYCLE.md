# Scanner crop test lifecycle

Issue #710 records a verification timing failure: the three-original scanner crop case passes every body guard, then exceeds its four-minute total clock during cleanup. Its intact repeat finishes only a few seconds below that clock. This case verifies actual recognition/review behavior, with explicit fixture-only queue priority; it is not a product latency or backlog acceptance test.

## Timer contract

The test already allows 120000ms for each recognition, catalog/visual and optional printing poll. Three serial photos can use six polls in base mode or nine with the full visual verification enabled. A blanket 240000ms clock contradicts those individual allowances and also includes independent generation validation and owned teardown.

The repair keeps every existing processing poll at 120000ms and every browser/action/assertion deadline unchanged. The body deadline is now the sum of those existing serial processing bounds plus 120000ms for setup/review: 840000ms in base mode and 1200000ms in full visual mode. These are verification safety ceilings, not measured product latency or throughput claims. A stuck individual stage still fails at its original two-minute boundary.

Independent actual-generation validation runs in its own fixture. Its existing inspect, offline descriptor and guaranteed exact-container cleanup commands retain their 120000ms bounds; the fixture has a separate 360000ms ceiling. It remains read-only/offline, validates the complete mounted generation and cannot download or publish an index.

Owned teardown also runs in a fixture with its own 120000ms clock. The unchanged early cancellation/authentication fence, exact owned record/file deletion and guaranteed late feedback sweep each retain their 30000ms database-command bound. The fixture registers cleanup before the first write so a partially created player/user is covered. The body clock can expire or the browser can close without consuming teardown's budget. Missing local opt-in/corpus skips generation access and leaves cleanup unregistered.

All original source assertions remain identical, including SHA-bound originals, expected printing/footer/collector, geometry, actual generation identity, photo-bound source captions, painted images, desktop/phone reload, visual failure recovery and zero Inventory. No application, recognition, storage, feedback, Inventory or worker-image change is included.

## Qualification

- Types pass after an initial evidence-directory setup failure prevented the first command from running; that initial attempt is not a passing check.
- An AST audit proves all 84 expect-related call expressions are identical after resolving only the new 120000ms constant. This includes nested call expressions, not 84 independent acceptance cases. All three processing-poll call sites retain their original deadline.
- Fresh pre-batch source/feedback/service checks and all 1092 retained original size/SHA-256 checks pass. Every one of the 13 ordinary service image/lifecycle/mount/limit identities must be conserved for this test-only batch.
- The full three-original native/browser workflow passed in 228107ms overall, with one passed case and zero failures, skips or retries. It covers desktop/phone reload and the existing visual failure recovery checks.
- A controlled timeout after all body guards and a controlled failure after creating only the fixture player both passed the cleanup contract. Their underlying Playwright cases deliberately failed; they are fault-boundary evidence, not successful acceptance cases. Independent checks confirm both exact owners, their records, feedback and original/preview files are absent. The temporary fault source was restored.
- Final conservation passed for all 13 ordinary service images/lifecycles/mounts/limits, seven original-table projections, nine substantive other-owner feedback projections and all 1092 original files (2832075218 bytes, identity/size/SHA-256).
- The qualified local Docker baseline is cumulative commit `33d180fb5a9293f4caea9c98e03537c80dc2538d`, including the now-merged paper-search PR #713. Loaded web image: `sha256:2331ba0f9d1576a1722d616a338bf284b4806512a807aacc6ba208839a7c0e8a`; application source fence: 596 inputs, digest `ddb9fc88d6b620ceedc45e280f1f9125c7ae95f03d1e4a12ec3a6de8886e1382`. This change touches only host-side verification and its report, so the qualified application images remain loaded without a rebuild.
- Current-main assertion preservation, types and final-head GitHub checks are checked again after synchronizing the branch. CI status is authoritative in the resolving PR.

The original dependencies #700, #706 and #709 are all merged. This batch is delivered directly against current main, with no open PR dependency. The resolving PR remains open for scheduled review and individual approval; #710 stays open until merge. No production deployment, physical scanner feeding or independent recognition accuracy is claimed.

Private evidence remains under `.local-data/crop-lifecycle-*`; no private images, credentials, raw authenticated replies or injected failure source are committed.
