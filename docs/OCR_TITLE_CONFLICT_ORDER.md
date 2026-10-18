# OCR title conflict ordering

Related to #837 and parents #463/#307. This is partial delivery; weak contained names, unlocalized face/body hints and broader independent recognition acceptance remain open.

The resolver already records TITLE_CONTRADICTION when an identifier candidate conflicts with a supported title. Previously equal identifier tiers used distance and local Card ID next, so a contradictory candidate could lead. The comparator now demotes known title contradictions within each existing identifier tier. Identifier retrieval/precedence, title matching, raw observations, alternatives, conflict/status and automatic-acceptance predicates remain unchanged. Text and catalog interpretation versions advance together; no bulk historical replay or repair is performed.

## Source controls

Base main: 8a33600c94f2ad795cc2bfc988dee9a8fc570682. Eight new synthetic controls have 3 passes and 5 failures on the old source and 8 passes after the comparator change. Four numeric-conflict cases cover primary competing numbers, supplemental explicit numbers, an extra OCR title token and a truncated number. Each tests reversed input order, swapped IDs, direct/oriented paths, retained conflict/alternatives and display truncation. Additional controls preserve same-name/List uncertainty, absent/typo/ambiguous titles, short/Unicode/face titles, identifier precedence and unlocalized hints. These are synthetic software controls, not native OCR, independently verified historic labels or an accuracy estimate.

The full acquisition unit suite passed 492/492 before the catalog-version increment; final exact-source qualification is recorded below as it completes. No thresholds, native models, image-combination policy, physical count, finish, condition, human review or final Inventory authority are changed.

## Linux and compiled review qualification

Implementation commit: f23e010 (exact full SHA and final report head are recorded in the PR and local state). All three required checks pass in [run 39085912923](https://github.com/sefaction/MTG-Archives/actions/runs/39085912923). Final report/test-head CI is recorded separately after this document is committed.

The cumulative web image rebuilds Next.js output from the existing application source and dependencies. Three native images preserve their base layers/configuration, changing only the two TypeScript sources and source manifest. Each actual Linux image passes all 29 focused recognition/photo-text controls: 116 aggregate passes. Source identity checks verify the 627-entry manifest and all 333 actual library/script files, retaining prior cumulative changes and four pre-existing native/web source differences.

| Role | Actual image digest |
| --- | --- |
| Web / ordinary / catalog | sha256:4408a19b4e268c9cd529a0fac7569619d8bb92b600d7cf576d85fa6451874c2f |
| Recognition | sha256:62effb5f20df819d2afd42951435ee1ff8c4484ba053f06a56b261a8d6aa298e |
| Visual | sha256:e67b41f9c56f424c02cd2d2edf509c57b1d59e221eeecedda043b8bb9e408003 |
| Printing | sha256:24df41fec640c39d26513d54987529fa7a6dc69a78e05b2d4837bfbe641caa40 |

An explicitly opted-in disposable PostgreSQL/web stack runs the actual catalog admission, claim, reconciliation handler and publication with synthetic saved OCR and provider responses. It checks both current interpretation versions, the supported first choice, retained conflict, unchanged candidate/raw output and zero Inventory. Chromium then verifies the compiled review API/UI order, chooses the contradictory alternative deliberately, saves LP, reloads and sees the chosen review preserved with zero Inventory. Desktop 1366px and phone 320px page-overflow checks pass; the phone screenshot was inspected. No native OCR or physical scanner is exercised. The disposable containers, anonymous database volume and network are destroyed after each attempt.

Failures retained: first custom build lacked app source; second lacked the repository's existing declaration files. Both failed before any shared runtime mutation. The corrected builder separately binds middleware.ts, types.d.ts and next-env.d.ts hashes. The standard manifest omits those inputs; newly filed #842 owns that provenance coverage defect, and the 627-entry count must not be treated as complete build-input coverage. The first browser attempt expected an image element even though synthetic cards intentionally have no image URL; the actual accessible printing control already showed the correct first suggestion. Only that assertion was corrected, and the full browser workflow was rerun successfully. No product UI fix was needed.

## Cumulative publication and completion

Author qualification passes on the local cumulative review at http://127.0.0.1:13011. All six intended roles are ready on the qualified images with actual Linux platform/source proof, preserved environment values, mounts, HostConfig/resources and unchanged native model generations. All 17 non-target peer identities/configuration/lifetimes and primary native event counters are conserved. The private canonical Compose changes only the six image pointers.

Paired original-byte/file manifests, the 118,505-card catalog projection, review uploads and 12 review-table fingerprints match. The visual index hash, size and mtime match. A 49.098-second empty-queue observation preserves review identity/configuration/lifetimes and native failure counters. This is a brief idle continuity check, not sustained-load acceptance or a resolution of historical native failures. The 64 decimal GB per-owner correction allowance and 2% random controls are preserved.

The final report/browser-test commit changes no application build inputs; its exact head and all three required checks are recorded in the PR and state. Detailed proofs are in the worktree-private .local-data/title-conflict-qualification directory: qualification.json, source-scope-proof.json, build-plan.json, builder-additional-source.json, image-unit-results.json, browser-qualification.json, runtime-proof.json, idle-refresh-proof.json, final-source.json and final-ci.json. Failed build/browser attempts remain separate records.

The narrow batch is author-qualified; #837 remains open for contained names, unlocalized spell-face/body hints, other identifier-tier policies and the rest of its stated acceptance. #838 printing/footer extraction, #800/#749 independent discrimination, #836 catalog freshness and #760 resource acceptance remain separate. Reused examples and synthetic controls do not establish an independent accuracy rate, historical cause or pixel-verified repair. The separate reviewer controls readiness, individual approval, merge and issue disposition. No production deployment, physical feed or historical data repair is performed.
