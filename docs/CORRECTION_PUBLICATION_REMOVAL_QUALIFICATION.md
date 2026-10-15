# Correction publication after explicit removal

October 15, 2026. [Issue #819](https://github.com/sefaction/MTG-Archives/issues/819), [PR #820](https://github.com/sefaction/MTG-Archives/pull/820); private storage/privacy parent #305. Source commit: 614ae255572e89be6c3104c7d86eb790b9e50941, based on main 94ecc9cb52b9d65ad722e31420c117ca829ef787.

## Problem and repair

Background publication read correction membership before waiting for the correction-owner lock. Explicit removal could finish during that wait; publication then used its stale membership to insert saved analysis again. The repair acquires the existing owner lock before reading membership. It creates no account for an absent example and retains the existing session-before-owner lock order.

The original acquisition photo remains independent of correction-library removal. This repair concerns recreated library evidence, not deletion of that original. Sampling, 64 decimal GB per-owner allowances, copy/backup/restore policy, recognition decisions and explicit Inventory confirmation remain unchanged.

## Deterministic database evidence

The permanent control is in scripts/verify-acquisition-corrections.ts. Actual changeCorrectionExample holds the owner lock after its real membership query; actual captureCorrectionPublication runs with the source session locked. The test observes its PostgreSQL advisory wait through pg_stat_activity, commits removal, and lets publication resume. Query results and transaction behavior are not replaced. A Prisma query extension provides only the removal scheduling barrier.

| Revision/control | Result |
| --- | --- |
| Unchanged main with regression | FAIL as intended: 2 recreated CorrectionEvidence rows, expected 0 |
| Fixed complete disposable acquisition/import run | PASS, 219,814 ms, all seven steps including owned cleanup |
| Actual built web image, Linux/PostgreSQL correction fixture | PASS, 6,660 ms after migrations; 14 fixture classes empty |
| Typecheck and patch checks | PASS |
| Exact source-head required CI | All three PASS, run 38771591407 |

The real fixed schedule leaves the example removed and its evidence absent. An independent owner's full examples/evidence/account projection stays equal. Existing tests retain ordinary publication and immutable earliest evidence, sampling/cap, atomic saves/replay/rollback, stale edits, copy/quota/pins, backup protection, label withdrawal, shared-blob GC/resume, restore tombstones, exact accounting and unchanged Inventory.

The initial negative runner is acquisition-2026-10-15T16-39-48-835Z; the fixed run is acquisition-2026-10-15T16-41-12-429Z. Both removed their exact disposable container and anonymous volume. Linux acceptance removed its owned database, volume and network with no cleanup errors. No shared review fixtures were created.

## Cumulative local review

Cumulative source integration a0ff3d84895ee2152b159496a614d8b11ce8ddd4 preserves the existing review stack, including #802/#804/#806/#810 and merged earlier batches. Only the library and its verifier differ from the previously qualified 626-input web build.

| Roles | Image index | Source digest |
| --- | --- | --- |
| Web, acquisition, catalogue | eeabc78f4903af4f9463184dd04c9978ee760f2f779c28d26f6d5a68754c9dc1 | 4e4a980800a19ee8d968d347ec63c7a97f89b7a2bd7be2406fa0140001960ee3 |
| OCR | b43092599539ea939ee9aecc7d44ca473d366db8acc7a0328df0558b2e4f9d17 | 16d18c3a58e3741d3728438e22aa8f410e7e307b8657bf2584592f07c75a7bf4 |
| Visual | 4a963269395dc7d1d55352c4e451d6d80262aa2663d646bc99bb7ab401996624 | same native digest |
| Printing | 5fb993f46186feb05881529bbacedae9bf103e906b468dff80d79e3eae26f14c | same native digest |

Web platform digest is 2806d50cd50da13b52be8aa1fd0cbe9838f3701623425fdf0883de4ff34c42c5. All 332 actual library/script files per candidate match their respective recorded inputs. Native candidates retain each exact base Config and every original image layer, copying only the two changed files and a projected provenance manifest. Their bases did not contain an embedded manifest: the saved e482 lineage was independently checked against every actual library/script byte before building. The native projection retains four previously documented, unused differences from web: app/decks/actions.ts, lib/acquisition-auto-confirm.ts, lib/backup.ts and scripts/verify-acquisition-commit.ts. This is not a claim of identical complete web/native source.

Six isolated roles were recreated serially. All three native readiness events preserve their previous model identities; no native failure event occurred in the qualified startup window. Every environment value, command, mount, network and resource setting is conserved. Full Config-field checks accept only declared image/hostname/Compose metadata changes; a one-byte memory-setting negative is rejected. All 17 peers retain exact identity/configuration/storage/lifetimes, including the 16 primary roles and isolated database. Primary native cgroup events are unchanged; recreated native prior counters remain recorded, and fresh instances have zero OOM/kill events. Later all-23-role stability and HTTP 200 pass.

Paired checks conserve all 157 primary originals / 904,889,236 bytes, catalogue 118,505 / 109,292 paper projection, entire review upload manifest, 11 actual table fingerprints and one absent-table marker. Only the six intended image pointers changed in the canonical private review descriptor.

## Retained failures and limits

The first publication guard stopped after web and acquisition were recreated because --no-deps clears the acquisition worker's Compose dependency label. The original label hash exactly matches web:service_healthy:false and the actual label became empty; both canonical dependency settings are identical. That failed comparison and full actual-state reconciliation remain preserved. Qualification resumed with those two existing containers, explicitly checking this metadata effect; they were not recreated again. No source, resource or dependency setting was relaxed.

Initial missing worktree dependency lookup, unexecuted tool-code quoting, Windows ESM URL and absent native embedded-manifest probe failures are retained in session/private evidence with their corrections. They do not establish application failures. Historical worker/OOM/lifetime and malformed-bundle failures remain unresolved by this change.

This establishes a bounded local correction-library race repair. It is not a reported production incident, complete native recognition-job end-to-end acceptance, independent printing accuracy, throughput, physical scanner acceptance, production deployment, or resolution of deck import #808. No UI changed; this batch does not claim fresh browser interaction coverage.

Private evidence is .local-data/publication-removal-qualification in the feature worktree, including first-load-failure.json, runtime-proof.json, data-proof.json, source-publication.json and the Linux logs. Final documentation commits leave built inputs unchanged. The separate reviewer owns readiness, individual human approval, merge and issue closure.

