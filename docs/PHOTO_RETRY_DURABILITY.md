# Pending photo retries must finish directory durability

Related to existing #305 and parent #310. This fixes a reproduced unfinished-upload retry defect; neither broad tracker is complete.

## Problem and resulting behavior

On Linux, publishing complete immutable photo bytes can succeed before syncing their containing directory fails. The initial upload correctly stays pending, but the previous writer immediately returned after checking an existing file. A same-identity retry could therefore acknowledge READY while the directory failure persisted.

`writeAcquisitionPhotoBytes` now repeats the directory open/sync/close barrier for an existing raw original or preview before reporting success. Repeated failures remain failures. A later successful sync recovers the same upload. Error identity, ordered combined causes and primary string code are preserved, including falsy errors. The Windows directory no-op, immutable bytes and existing path, ownership, size, free-space and Inventory controls remain. An already READY receipt replay still skips the writer and adds no effects.

## Tested source and runtime binding

Author qualification used source `66496bbb4281d690c1246996edf2f0c9e2d997d8`, tree `409ca802068d7b2fa6e62d2885739e94c108807b`, based on main `a416395fe852b40c53edb349ee13763dc23b74d9`. Later changes to this guide do not change application or test inputs. Required final-head hosted checks remain separate.

The canonical production build passed compilation, types, static generation and client guards. Candidate image:

```
sha256:1607124a90eda1adf5b68cda9af9c6b4e8bb2e449f23816fce97004c5d0ea44c
```

The Git export contains 1,689 files; all 1,319 declared build inputs match their recorded raw export hashes and the Git source after newline conversion only where applicable. This is not a claim that every Windows-exported byte equals the LF Git blob. The declared input digest is `f314a546d4058527791a0e3f7b39265f57b1e809e10a34eaf4319690d1d8753c`; archive SHA-256 is `d0726ddff4bddd3717cd3cc82a9c02a05b05793c5b1f2702f5800488d858a258`.

Readbacks from the actual compiled review container match its manifest and this source. Its `lib/acquisition-files.ts` SHA-256 is `5f14c229ce26f54649ed7b0f4f7e60ebf9b6b7ae9b9ff7b42fdf8a33055ccddd`. The old compiled negative used retained image `8a8a29c169f439ae7aafd588d4e543573d3686ee9bb25d15cb5bad34c0eccd32`: its photo writer matches the named main baseline after newline normalization, while the whole image contains other earlier changes. It is a negative control, not qualification of the current application or publication of those other changes.

## Verification

- Actual-source baseline controls: 27 pass, seven expected failures, one Windows skip. The seven failures cover persistent directory open/sync/close for raw and preview plus combined sync/close ordering. Fixed writer controls: 34 pass, no failures, one skip.
- Correct four-file focused command: `tsx --test tests/photo-write-cleanup.test.mjs tests/acquisition-files.test.ts tests/acquisition-photo-partials.test.ts tests/acquisition-upload.test.ts` — 53 pass, no failures, two Windows skips. Full host typecheck and changed-file lint pass.
- Full Linux suite: 1,975 executions, 1,974 pass, no failures, one existing Windows-helper skip, 132.527 seconds. Candidate-derived test image added Git only; exact source-only exports and a container-local Git index support source-contract tests. Serial execution with an init process kept the unchanged 2 GiB / two CPU / 256 PID envelope.
- Actual full SQL verifier `scripts/verify-acquisition-store.ts`, after 95 migrations: the exact main-baseline writer negative fails at the declared persistent-retry assertion (actual 200, expected 409). The fixed full suite passes: two persistent refusals preserve the entire pending row, immutable complete bytes, no temporary parts and zero downstream records; recovery and READY receipt replay succeed once. Each run restores every full-row fingerprint across all 85 tables.
- Actual compiled app, authenticated browser: old-image 320 px negative reproduces the erroneous 200/READY with artifact/candidate/job counts 1/1/1 while the fault remains. Its full 85-table baseline is restored. Current-image 1,366 px and 320 px cases both pass, no skips/flaky cases, 13.493 seconds. Three requests retain identical URL/body type and upload identity. Directory events are `refused, refused, synced`; two refusals leave the complete pending state unchanged. Recovery changes only `ready` and `readyAt`, preserving all 21 other photo fields, raw bytes/digest, seeded Inventory and zero commit count. Re-enabling the fault before READY replay adds no filesystem event or database effect. Reload shows one saved photo. Phone pending and desktop recovered screenshots were visually inspected; no horizontal overflow.

There are five executed full 85-table conservation pairs: two SQL and three browser cases. A fresh pre-retirement snapshot also matches the browser baseline, with zero upload files and no fault marker. The browser hook is explicitly opt-in, restricted to the disposable database/path and exact photo-directory open; production startup/configuration does not enable it.

## Preserved failures and limits

The initial restricted host invocation failed at realpath access before storage injection (34 failures/one skip); it is separate from the admitted seven-failure negative. An early focused command named a nonexistent additional file that the runner ignored; no coverage is claimed for it.

Three Linux harness attempts remain recorded as failures, not retroactive passes: omitted source-only exports (85 failures), then missing Git/process pressure (32 failures), then missing local index/unreaped grandchildren without init (23 failures). Complete exports, a Git-only test image/local index, serial execution and init address those demonstrated harness causes. An isolated eight-grandchild probe measured eight zombies without init and zero with it; the successful suite sampled 27 PIDs, no PID/OOM limit events. No application limit was raised, and no timezone dependency was added. A direct Chicago offset probe was correct.

This is controlled directory-fault recovery, not physical power-loss, native scanner, recognition accuracy, release-scale, production deployment or independent user acceptance. Foundry was unavailable on this node; repository and live GitHub context were used. Author qualification is distinct from independent review, final-head CI and individual merge approval.

## Resource handoff

All 11 owned containers stopped at their recorded terminal outcomes and were removed, along with two owned networks, the verified empty sole upload volume and the unreferenced Git-only test image. The runtime claim was released after exact owner/thread verification. The four pre-existing review services retain their original stopped state, images, ports and mounts. The current candidate and old negative image remain retained; reconstructable export/archive scratch is retired after preserving manifests, readbacks, logs, traces, screenshots and failure evidence. No shared cache pruning occurred.

Post-runtime cleanup: about 476 GiB host disk and 90.6 GiB host memory available; VM observation before database stop showed about 892 GiB filesystem and 22.2 GiB memory available. Docker storage readback: 21 images / 26.72 GB, four stopped protected containers, four existing volumes / 158.5 MB, 44.85 GB shared build cache. These are observations, not ownership of the shared cache. Raw private records are under `.local-data/photo-retry305/`; they are intentionally excluded from publication.
