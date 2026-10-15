# Correction-copy preparation cleanup

October 15, 2026. [Issue #822](https://github.com/sefaction/MTG-Archives/issues/822), [PR #823](https://github.com/sefaction/MTG-Archives/pull/823); related private storage/privacy parent #305 and correction feedback #463/#307. Source: 6cdd407cf9064ccdad985a5fb633429d27570336, based on main73a84d6d95bd8234b1cc2083f3c604e363403d4d.

## Behavior

A failed partial write followed by a handle-close error skipped temporary-file removal and replaced the original storage reason. The capture worker could consequently record ORIGINAL_COPY_FAILED instead of ENOSPC.

Preparation now attempts both existing cleanup actions independently. A lone failure keeps its exact identity; combined failures retain ordered errors and the original cause. The aggregate carries the original storage code for the worker's existing safe classifier. Failed unlink remains an explicit cause and can leave a temporary for later recovery; successful cleanup is not claimed when removal itself fails.

No immutable publication, no-follow/digest guard, source retention, owner allowance, prospective sampling, copy lease, backup or retry policy changes. Source originals remain protected; 64 decimal GB/owner and 2% controls are unchanged.

## Evidence

The permanent tests extract the complete actual preparation and capture functions without changing their statements. Narrow adapters create real bounded partial files and perform real handle closure, then inject controlled storage errors. Source and independent-neighbor bytes are checked in every control, and exact-owned fixture roots are removed.

| Check | Result |
| --- | --- |
| Unchanged-main negative controls | 2 intended failures: unlink skipped; ENOSPC replaced by ORIGINAL_COPY_FAILED |
| Fixed preparation/capture controls on Windows | 9/9 PASS, 634.5344 ms after final fixture precondition |
| Existing correction-file/policy controls | 9/9 PASS |
| Actual web, OCR, visual and printing images | 18/18 each, zero failures/skips/cancellations; 4,767 / 4,047 / 4,046 / 3,964 ms |
| Actual built web image, disposable Linux/PostgreSQL correction fixture | PASS, 5,415 ms after migrations; 14 fixture classes empty |
| Types and patch checks | PASS |
| Exact source-head required CI | All three PASS, run38787934684 |

Controls cover continued unlink after close failure, all three causes, lone open/write/sync failure identity, repeated close failures, harmless ENOENT, original retry classification, successful preparation, duplicate immutable publication and cleanup. The Linux fixtures also preserve ordinary publication, sampling/cap, owner isolation, accounting/quota/pins, removal and restore behavior.

Fault classification uses the actual capture function with a bounded database-writer adapter. It does not claim an actual combined-error database incident or natural disk exhaustion. The separate real PostgreSQL fixture establishes normal compatibility; no exhaustive disk-full/backup/restore acceptance follows.

## Cumulative local review

Current main was integrated into the existing cumulative branch as2169285b6c5d06d8c53f26605db8285bdd36d2fa, preserving unmerged #802/#804/#806 source. Repair integration is4d27812797ddfed9434e116cd8d1282e3eeac20b. Exactly one of626 application inputs changes: lib/acquisition-correction-files.ts. Qualified actual helper SHA-256: e0ea0e18c3b0118aef3cece5ce1e2b9dbd8bf5637154cf3a3fa019a4963db55b.

| Roles | Image index | Source digest |
| --- | --- | --- |
| Web, acquisition, catalogue | d62c1533f1046da3f8b7547d72d95053113f2a32572d0bf0bce30d78bf7e21a5 | 051cd1cf9ee5481a12a4c4379fbb15ee9c25baf000b4a0902d9fd1f333817336 |
| OCR | 685571f21919d14803d45ade28bd4f989b2870657747e19ef7bd3566d8df3924 | cd7ce286de160edb1171d793897dee1bc6328e653b72ace4334ac41da3717b2f |
| Visual | 3c3e8eab83ce256dbd89ccbb8ff39acbfe68aaeaa4f2631b24b54b78f72af1bf | same native digest |
| Printing | b81d7b96f76e65963f3e7843a04161d3065bf6c348b65ff4d10aa3e7c4ef0220 | same native digest |

Web platform digest: 9bf326f7a058fee28e71812e6ab06e7b78895023b05131388673cd35fb2c052c. Each candidate verifies all332 actual library/script byte hashes. Native builds preserve every exact base image layer and Config, copying only the changed helper and provenance. Their four earlier unused differences from web remain explicit: app/decks/actions.ts, lib/acquisition-auto-confirm.ts, lib/backup.ts and scripts/verify-acquisition-commit.ts.

All six isolated roles are loaded serially at localhost13011. Full environment-value, Config-field, command, HostConfig, mount, network and resource checks pass; a one-byte memory-setting negative is rejected. All17 peers retain exact identity/configuration/storage/lifetimes, primary native cgroup events stay equal, recreated native prior counters remain recorded, and fresh instances have zero OOM/kill events. Later all23-role stability and HTTP200 pass.

Paired snapshots conserve all157 primary originals /904,889,236bytes, catalogue118,505 /109,292paper projection, entire review uploads,11 actual table fingerprints and one absent marker. No shared review/Inventory fixtures were written. The owned Linux database/container/volume/network are removed. Only six canonical image pointers change.

## Retained failed controls and reconciliation

The first Linux web window passed17/18: its32MB test tmpfs correctly failed the unchanged2GB free-space guard. The failed log remains. Only the disposable test filesystem's virtual advertised size was corrected to3GB, with an unchanged512MB container memory cap and bounded tiny fixtures. No application guard, deployment resource setting or physical capacity was changed.

The first startup guard failed its hard-coded old visual descriptor3c183fee. The actual current descriptor was814844fa5b63a5e9f7a560edfd602e7c7add30923f376dfa4a9f9b188c360769. Reconciliation establishes an index rollover before this run: marker d50a69189aa41a4e61b5bfd7744491503832d6e6db373042cee9ce90530daca8 was modified at17:55:22.586Z, and the unchanged original printing container announced descriptor464156783b23ae7fe8f5e676851fb22465bab32c3c5377373ca701131fd1f283 at17:55:25.911Z, before the18:35 run.

The unchanged base visual image and candidate produce identical descriptors on the current read-only assets. Only indexSha256, catalogSha256, manifest and digest differ from the older descriptor; recorded trained-weight/encoder identities, Python/code hashes and reference counts are unchanged. The index publisher is not attributed. Qualification resumed against that proved pre-existing current generation, reusing the five already recreated containers and recreating only printing. The original failed comparison is retained, not retrospectively marked passed. OCR retains f40093b83e51f813f0fd70e64e65d1eae51234a3a9f89c0397ea34fda4391405.

Cumulative merge conflicts preserved the qualified v13 resolver and both checkpoint histories. An initial missing private-directory write failed before editing. A subsequent raw source comparison failed solely on resolver line endings; its exact prior working bytes were restored, Git blob remained equal and all626 inputs then matched before the new repair. These setup/byte guards remain evidence.

The new fixture explicitly creates its own private parent directory, avoiding test-order dependence. That test-only correction is published with this report; it and documentation change no application build input. Final CI/publication identities are recorded in the PR and checkpoint.

This is local software qualification, not a natural storage incident, production deployment, physical scanner test, independent recognition accuracy, native throughput or historical worker-failure resolution. No UI changed and no new browser interaction coverage is claimed. Private evidence is .local-data/prepare-cleanup-qualification in the feature worktree. Separate review, individual approval, merge and issue closure remain the PR reviewer's responsibility.
