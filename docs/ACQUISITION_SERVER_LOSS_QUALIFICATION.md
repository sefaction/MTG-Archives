# Acquisition web-server process-loss qualification (#310)

## Declared boundary and stopping criterion

The acquisition validation plan explicitly requires server restart recovery before and after finalization/ACK. This opt-in test covers a real SIGKILL/restart of a newly isolated Next server while its browser and PostgreSQL stay alive. It complements the separate browser-process and database-process tests. Stop after the two declared phases pass at desktop1366 and phone320, or investigate the first unexplained failure. No additional load or physical scanner session is implied.

Four generated JPEG originals enter the real authenticated upload/review workflow: three explicit human selections and one pending card. Controlled processing jobs are marked failed without running recognition. These fixtures establish software persistence/retry behavior, not optical accuracy.

## Execution and protection

`tests/ui/acquisition-server-loss.spec.ts` refuses normal execution unless `MTG_SERVER_LOSS_TEST=1`. A new internal network, sole PostgreSQL data volume, and private upload volume belong to one run and random nonce. The exact web image/container, labels, namespace, sole upload mount, database target, restart policy and process state must match before either fault. No port is published and no production name, path or existing volume is a destructive target.

A small independent network anchor preserves the localhost browser origin while the server is absent. PostgreSQL and an independent fixture client have separate private network endpoints; the server and browser controller share the anchor namespace. Only the server and fixture client share the new upload volume. The database, anchor, fixture client and controller retain their original IDs, images, configurations and StartedAt values. Their network endpoints and exact volume reference sets are checked before/after faults. The Docker socket is available only to this explicitly owned controller; this is a destructive local qualification, not a public application endpoint.

1. An AFTER-member trigger verifies staged stock, audit, receipt and membership, then waits on the owned advisory blocker. Kill the exact web process; verify exit137/noOOM and a failed browser request with its Retry control intact. Let the blocker finish naturally, verify the original transaction is gone and all four ledger collections are empty, remove the test trigger, and restart the same server. Retry the original frozen request to save exactly one copy; replay adds nothing.
2. Hold a real successful second commit reply after the database contains two copies/receipts/members/audits. Kill/restart the same web, verify the durable ledger stays unchanged, then fail the held reply. The original frozen UI retry returns200/replay and adds nothing. A new third explicit addition works normally; the fourth card stays pending.

Both layouts verify unchanged source bytes/metadata, saved reviews, controlled job records, owner original access200 and unrelated user403. Each completed fixture cleanup must restore every public-table fingerprint (85 in this migrated schema). A stopped web, live blocker, active transaction or uncertain ownership preserves recovery records for explicit owner reconciliation; failed tests never silently reset the database.

The focused ownership tests reject foreign IDs/images/labels, namespace/storage/database changes, published ports, restart policies and missing/ambiguous process state. Full immutable IDs and separate role images are required.

## Qualified author evidence — October24,2026

PR #963 records this bounded gate. Both actual Chromium cases passed, no retry/skip, in2.9minutes: desktop1366 about1.5minutes and phone320 about1.4minutes. Each performed two exact server SIGKILLs with exit137/noOOM, a later StartedAt on the same container/image/configuration, and unchanged independent peers. PostgreSQL retained fsync/full_page_writes/synchronous_commit=on.

| Observation | Desktop1366 | Phone320 |
| --- | --- | --- |
| Staged member transaction blocked; web dies; browser request fails | Pass | Pass |
| Blocker exits0 naturally; original transaction disappears; ledger empty | Pass | Pass |
| Original frozen retry saves1copy; replay changes nothing | Pass | Pass |
| Durable held-reply commit remains2copies across web loss | Pass | Pass |
| Original frozen retry returns200/replay; ledger unchanged | Pass | Pass |
| Next explicit addition leaves3receipts/members/audits and1pending | Pass | Pass |
| Originals, saved reviews/jobs, owner200/foreign403 | Pass | Pass |
| All85 public-table fingerprints restored after cleanup | Pass | Pass |

Actual desktop durable-retry and phone uncommitted-retry screenshots were inspected. The phone confirmation stays within its viewport and its explicit Retry control is usable.

### Source and evidence binding

The actual browser harness is `2d96576c8e71f73309083afc9016529e985f3ecd`: six source files match archive `060db61c2d8d7e949aa6e68140db0b48f06b79ca0c0b94a45a4596632f61a2b7` after CRLF→LF only. The application image is unchanged qualified `sha256:11d13e2e309389983851fb2612b8d9970f9eb77c0a31712e336cdc88cc83ab07`, built from `a8aa1f8`. All513 application inputs match current base9b3add47, and all1287 original loaded image source files match manifest `b96ea183`. Later main differences are tests, verifier and documentation; no full later-source runtime rebuild is claimed or needed for this test-only change.

Independent source review found a cleanup refusal gap after those successful runs: a rejected page.close was recorded as an error but did not by itself prevent fixture deletion. Corrected source `454596212c7efeaf9740989db6317cb22dbea8b3` positively observes page closure and permits destructive helpers only with confirmed page, blocker and database safety. A close error remains a failing result even if closure can independently be confirmed. Six actual-source ownership/cleanup tests and focused locked TypeScript pass on archive `1352641bf9830e602230f0f47a709a63dde5757d8cb889fd2e7d68cbe6353075`, including zero deletion-helper calls for rejected/unobserved closure, a live blocker or unsafe database, plus the confirmed positive control. The application, fault scenario and product assertions are unchanged, so the two successful browser phase results are reused with this explicit harness delta; they are not described as execution of the later full harness. Final hosted full type/unit/build/SQL checks and independent review are recorded on PR #963's actual final revision.

### Failures, retirement and limits

The initial browser attempt refused the controller before any fixture records were created: container-network mode inherited the anchor hostname, so HOSTNAME identified the anchor rather than the controller. The corrected harness reads the run/nonce/web-bound private manifest and independently verifies the full controller ID, role, image, namespace and configuration. No ownership check was weakened.

Two local full type-check attempts exceeded their small128/512MiB JavaScript heaps; these are retained tool-capacity failures, not successful checks or product OOM findings. Focused type checks then passed in a separate bounded768MiB container, serialized within the original unused browser budget. Full final-revision hosted verification remains a separate gate.

Admission reserved2944MiB in the Docker VM,768MiB Windows reserve and0.2/0.5GiB host/VM storage after fresh capacity/workload checks. No shared limit or unrelated job changed. After both85-table pairs matched, exact pre-retirement checks found zero uploads, session/photo/job/auth/user/player/stock/receipt/member/audit records, active transactions or test barriers/functions. All nine owned temporary containers (including earlier failed controllers/type checks), both solely referenced disposable volumes and the internal network were retired. Exact runtime claim `bc2a9f5a-432c-4cd5-9187-88a2e5743fa2` was released; other reviews, rollback images and installation data are preserved.

Compact source/harness/results, failed attempts, lifecycle and terminal-state records remain in `.local-data/server-loss-310-20261024/`, especially `current.json`, `runtime-source-binding.json`, `loaded-source-binding.json`, `harness-binding.json`, `browser-conservation.json`, `corrected-focused-terminal.json`, `pre-retirement.json` and `retirement.json`. No private recognition source is used or published.

This does not complete broad #310/#302 or establish native/optical accuracy, Windows/agent/worker, host/power/storage-loss, production deployment or independent user acceptance. Each PR still needs Brian's individual approval and explicit merge request.