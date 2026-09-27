# Card acquisition validation and release gates

**P1 pure foundation is merged; persistence has local database evidence below.** Corpus, phone and hardware gates remain future work. No recognition or hardware pass is implied. Read [milestones](CARD_ACQUISITION_MILESTONES.md) for dependencies and [architecture](CARD_ACQUISITION_ARCHITECTURE.md) for semantics.

## Gate ledger

| Gate | Required evidence | Disqualifying outcome |
| --- | --- | --- |
| A — domain | Executable state/count/capability tests and PostgreSQL identity constraints | Artifact count used as physical count; recognition changes count |
| B — target | Exact 300→263 acquired +37 untouched; best-effort/image 263 allocated +37 retained overflow; replay/restart | Duplicate physical candidates, silent loss, nondeterministic target order |
| C — canonical | Labeled single/multi/duplex geometry fixtures with manual repair | Wrong count/crop silently accepted; evidence linkage lost |
| D — recognition | Held-out real image benchmark with exact Scryfall printing+language truth, engine/catalog/corpus versions | Contradiction auto-accepted; unsupported catalog treated as complete; wrong automatic choice hidden by average score |
| E — inventory | Real concurrent DB tests with per-write fault injection, group quantities and audit/receipt checks | Partial commit, duplicate candidate, lost opener/provenance, stale unacknowledged overfill |
| I — image release | Full user lifecycle, bounded performance, restart, recovery and image privacy | Worker/Docker restart loses workflow; restore cannot account for committed/pending candidates |
| F — virtual TWAIN | Actual Windows source/DSM transfers through agent; 100 sequential sessions | Only fake device enumeration demonstrated; unhandled native state/error or fabricated sheet identity |
| G — hardware | Device/driver/profile-specific physical matrix and counters | Damaging feed, unexplained count/order/overscan, unqualified exact-stop claim |

## Test layers and commands

- `npm run verify:acquisition`: reusable local pure-domain plus real PostgreSQL checks. It starts a uniquely labeled local Docker fixture with a random loopback port, applies migrations, tests ownership/replay/concurrency/rollback/corrections, removes its own container and anonymous volume, and saves `checks.log` / `result.json` under `.local-data/verification/`. No app snapshot is used. Add `-- --core` for the full existing typecheck/unit/build sequence. A failure is nonzero and records the failed stage; cleanup runs on ordinary failure too. A killed process can leave its clearly labeled test container for explicit cleanup.
- CI `Acquisition PostgreSQL integrity` runs the same database fixture script against a separate disposable `acquisition_integrity` database. These tests establish persisted staging behavior only; upload durability, exact printing recognition, phone capture admission, worker recovery and inventory commit still need their own evidence.

- Pure reducers/resolver/target/event tests belong in `tests/*.test.ts`, exercised by existing `npm test` (`tsx --test`). Include positive and negative behavior; do not validate transactional claims via source-string assertions.
- Real DB/filesystem/worker tests require a dedicated opt-in command and disposable local fixtures, modeled on current Docker/Prisma browser helpers and `MTG_LOCAL_PILOT_TEST`. Add its command to the release gate when implemented; it does not already exist. Use random fixture identities, exact local target checks and `finally` cleanup; never require production data.
- UI tests go in `tests/ui`, serial single worker against local Docker port 13001. Capture data/auth fixtures default to trace/video off, following existing import/auth tests. Use synthetic data for shareable screenshots.
- Existing `npm run verify:core` generates Prisma, typechecks, runs units and production build/client-manifest guards. GitHub Core uses this on Linux; it has no live PostgreSQL fixture, private corpus or native Windows device. Keep it passing without speculative native installs.
- Existing `npm run verify` also runs Playwright. Run with needed local fixture opt-in and all relevant future workers loaded from exact branch revision. Verify no skipped required cases; include affected CSV/manual/move/trade/deck/backup regressions.
- Actual image/OCR corpus benchmark is a separate explicitly versioned offline gate with real engines, not mocks. Native TWAIN needs an explicit Windows-only job/manual runner and test evidence. Neither can be silently claimed by Linux CI.
- Evidence records application commit, image digest, migration state, worker/agent versions, corpus/catalog hashes, commands, environment, passes/failures/skips, denominators and cleanup. A passing fixture does not prove hardware or production deployment.

## Required integrity cases

| Category | Cases |
| --- | --- |
| Counts | 1→1, duplex 2→1, multi-photo 1→6, repeated observations N→1 with explicit identity; unreadable #147; missing back/multifeed uncertainty; detector correction and stable ordering |
| Targets | 0/full/unknown, explicit manual limit, selected-section + overall cap, arbitrary/unsectioned labels, 100 normal/300 stress, below-target source exhaustion, overcapture, refills and retained overflow |
| Replays | Same event/artifact/command payload repeated; same key conflicting payload rejected; out-of-order/gap/ACK loss; new run not mistaken for old run; identical images on distinct physical candidates preserved |
| Concurrency | Two workers with lease handoff; stale output after review; two review editors; double commit/same or different key; capture versus every occupancy/layout writer; sorted multi-destination locks; retry limits |
| Commit | Failed inventory/audit/receipt/status steps roll back together; missing printing/finish/owner/opener; 999+ quantities not clamped; no collapse of notes/pull/round/source distinctions; already committed candidates excluded |
| Capacity | 263 snapshot→258 room blocks silent commit; five left pending/reassigned; user-confirmed override recorded; any subsequent occupancy/layout/candidate change invalidates old override |
| Security | Owner and explicit admin scope at every API/file path; agent cannot commit; revoked/expired/disabled credentials; malformed images/paths/payloads; quotas; no secrets/raw images in diagnostics |
| Recovery | Browser/server/worker/agent restart, crash before/after file finalization and ACK, disk full, cleanup during lease, interrupted catalog refresh, backup/restore and server epoch fencing |

Physical conservation assertion: confirmed candidates = committed + pending (including overflow/unresolved) + explicitly set-aside physical candidates. Corrected false detections are recorded separately, not silently subtracted. Inventory quantity delta = newly committed candidates only. Unacquired fixture inputs and scanner paper still in tray are not confirmed captures.

## Recognition corpus and measurement

Small redistributable synthetic geometry and mocked OCR fixtures may live in Git. Private card scans/photos and large native/model assets stay outside normal Git history. Commit manifests with asset hash, version, acquisition source/rights, dimensions, physical grouping, expected regions/sides, exact Card/Scryfall/language identity, finish expectation (including UNKNOWN), expected review/conflict and train/tuning/held-out split. Missing private assets must fail the requested benchmark or mark it unavailable, never silently pass.

Include modern, old-frame, borderless, showcase, extended art, basic land, token, DFC front/back, non-English exception, dark/light frame, rotation, perspective, blur, glare, partial crop, unreadable, six-card phone photos, duplex/reordered sides, and separate copies with identical art. Add cards sharing names/art across printings and missing-language/catalog cases. A Scryfall digital image alone does not establish phone/scanner quality; synthetic transformations supplement real captures.

Ground truth is independently checked by exact printing/language and physical membership. Keep near-duplicate photos/printings out of both tuning and held-out sets. Report detection count error, exact-printing auto-accept precision (correct automatic choices / all automatic choices), automatic coverage, review rate, unreviewable rate, per-layout/language errors, latency and peak memory. Report denominator zero as unavailable, not perfect precision.

Start with a representative 200–500-card evaluation, but do not adopt 99.5% population precision as proven from that sample. With zero errors in 500 automatic choices, even a simple one-sided 95% binomial bound is roughly 99.4%; automatic choices may be far fewer than all corpus cards. Require zero observed wrong auto-accepts on the held-out release corpus, publish denominators/uncertainty, then agree promotion threshold and corpus expansion before unattended automatic selection. A discovered wrong choice returns the affected policy/layout to manual review. Automatic printing proposal/acceptance never bypasses explicit inventory commit.

## Performance and operations

Normal target: up to 100 physical candidates per session; stress: 300, concurrent uneven owners, 150,000 stored copies and thousands of location sections. Benchmark real catalog size, upload bytes, decoded pixels, job RSS, queue delay, per-stage p50/p95, review response time and commit transaction duration. Set concrete caps and latency budgets using actual host measurements in P3/P5/P8; no unsupported cards-per-second promise now. Streaming ingestion, bounded work, lazy images and paged review are required regardless of benchmark.

Private artifacts add disk/backup cost. Before first image release, document approved retention, free-space reserve, owner/session quotas, rejected upload behavior, raw/derivative purge rules and manual recovery. Exercise a quiesced/watermarked backup and restore with committed/pending/overflow sessions; verify file hashes, receipt conservation, stale lease invalidation and revoked restored sessions/agent credentials. The existing restore process replaces database and files in separate stages; capture must detect incomplete evidence rather than assume atomic cross-store restoration.

Diagnostics include timestamp, session/run/event/candidate/artifact IDs, provider/version, stage/state transition, requested/actual config, retry/lease and reason/error codes. TWAIN adds process/DSM/source bitness/version, transfer lifecycle, side/boundary evidence, pending transfers, local stop request/count and final outcomes. Redact tokens, pairing codes, full user paths and images by default. Export image samples only through explicit user selection.

## Hardware matrix

Use the same test IDs and privately stored ground-truth corpus for primary fi-7160, then optional fi-6130Z/fi-8170. Begin with expendable bulk cards. Verify current fi-7160 vendor/driver documentation when the device arrives; archived fi-6130Z specifications are historical references, not evidence for this device. Paper capacity and ID-card handling claims do not establish a safe MTG batch size.

| ID | Test | Evidence and gate |
| --- | --- | --- |
| H01 | Baseline driver/DSM/agent/OS/source/bitness, counters and rollers | Record actual supported combination and requested/negotiated profile; do not infer support from model family |
| H02 | Single-card trials, including simplex and duplex | Pairing, order, crop, skew, before/after surface photos; stop if damage occurs |
| H03 | Repeated 10-card then 25-card loads, larger only if safe/stable | Attempts, doubles, jams, missing cards, wear and throughput; many safe refills may form one session |
| H04 | Targets 1, 2, 5, arbitrary N with additional cards loaded | Mark position of N+1 in tray/transport/output; record stop timestamp, complete physical count and overscan distribution |
| H05 | Duplex ordering, missing side and generic/DFC backs | Prove identity from actual source metadata or document/manual-reconcile uncertainty |
| H06 | 300 DPI baseline; supported 200/400/600 alternatives | OCR/crop result, bytes, RAM and throughput on same cards; use actual negotiated values |
| H07 | Auto-crop/rotation/blank-page removal on/off | No lost title/collector edges, dark face or side; start conservatively until tested |
| H08 | Safe controlled multifeed/jam/error/source-exhaustion cases | Stop/recover codes and count uncertainty; no automatic rescan counted as new copy |
| H09 | Surface/roller/consumable review after each safe stage | Visible marks, feed reliability and counter changes; no unsupported durability claim |
| H10 | Device disconnect, application restart and refill | Persisted session/run reconciliation, retained artifacts, safe physical recovery |

Comparison report: raw n, failures/doubles/marks per observed sample, normalized rates with sample size, pairing errors, overscan frequency/count, actual cards/time, bytes/card and recognition review rate. Sleeves are outside the confirmed baseline and require separate validation. A virtual source pass qualifies software integration only.

## Kickoff qualification additions

P1 batch 1 must cover every [kickoff acceptance case](reference/card-acquisition/implementation-kickoff.md#required-acceptance-cases) with behavioral tests. Gate A remains incomplete until real PostgreSQL identity/ownership constraints pass; pure replay/stop fixtures are only the pure portion of Gate B.

Recognition evaluation compares Tesseract+metadata, PaddleOCR CPU/qualified GPU, perceptual/local-feature and embedding top-k+exact-print verification, plus geometric versus card-trained detection. Record code/runtime/model/weights/preprocessing, dataset licenses and supported coverage. Compare identical held-out queries and acceptance policy; changed precision/search approximation requires requalification. No fixed borrowed threshold or README performance claim is evidence.

Corpus expands to real iPhone/Android, multi-card scenes, webcam sequences, fi-7160 when present, older layouts, non-English, same-art different printings, foil glare, DFCs, unreadable/generic backs, noncards and missing-catalog/unsupported/new-set cases. Split by physical specimen/session/device to avoid leakage; reference catalog images are retrieval inputs, not held-out query captures. Missing hardware subsets are explicitly not run.

Report exact-print+language precision AND coverage, recall@k, detection/count errors, repeated/missed copies, source/layout/language denominators, recapture/review rate, p50/p95 capture-to-result and end-to-end time, bytes/card, CPU/RAM/VRAM and operator minutes. The product metric is correctly inventoried, physically reconciled cards per operator minute. Unavailable denominators are not perfect scores.

Phone gates cover permissions/HTTPS, photo library, real HEIC/HEIF/orientation or tested alternative, interruptions/progress, episode removal/rearm, repeated versus separate copies, tab-close/eviction/lock and durable ACK recovery. Inbox gates cover finalization, ordering, retries, quarantine, removed destinations and original retention. Optional GPU gates record actual execution provider, warm/cold timing, fairness, memory/OOM and explicit CPU fallback/pause. A missing GPU does not block CPU acceptance.

## P1 persistence evidence (2026-09-27)

The reusable full validation passed 635 unit tests, typecheck, production build, all additive migrations and the real PostgreSQL acquisition suite. The suite covers live ownership/Admin Mode, a 72-card remaining-capacity snapshot, concurrent create/event replay and conflicts, reconnect, injected transactional rollback, stale edits, reviewed-decision preservation, count correction, revoked access, destination edits/deletion and cross-run constraints. Inventory stays unchanged. The final helper rerun records source digest `8f3e6fffee6dcdbd465cd5b6259638eb31f8adc4486e5a71d221e3bd78881316`; local reports are ignored by Git.

Correction: that earlier Docker build used the primary checkout because its older Compose overlay ignored the review-context variable. The admin-route pass was on that older image, not the persistence code. Use the explicit worktree build and corrected cumulative evidence below. These tests establish saved-session behavior only. Phone upload admission, private image bytes, worker leases, actual recognition and inventory commit remain subsequent work. Generic source ingestion retains overflow; it does not yet implement the stricter phone capture admission limit.

## P2 orchestration evidence (2026-09-27)

The same reusable verifier now checks durable 72-slot phone admission, the final-slot race with six callers, reservation replay after stop, rejection of unreserved candidates, and a progress read distinguishing reserved from received photos. Known destination/section capacity determines the remaining target. Unknown capacity is open-ended with a running count unless the user chooses a limit; 72 and 300 are fixture sizes, not fixed product caps.

Versioned stage jobs enqueue immediately after the server finalizes their artifact, with pipeline/runtime/model/catalog/index/execution identity. Database tests prove duplicate enqueue, two competing workers, lease handoff, stale completion/heartbeat rejection, preservation of human review, timeout abort, bounded errors/crashes and cancellation. Outputs remain staged evidence, with no Inventory authority. Queue adapters must stop native child processes when aborted; no real OCR adapter is claimed by these tests.

The fixture suite persists exact-mode 263 captures plus 37 untouched source items and logical-mode 263 allocated plus 37 retained overflow, then replays reversed delivery across a new database connection. These are software fixtures, not scanner hardware results. Full core passed 635 tests/typecheck/build, and the final progress-readout PostgreSQL rerun passed; disposable containers/volumes were cleaned.

Corrected cumulative Docker validation: explicit worktree build `sha256:23459d0d07eb2df3c8b6d4ab91af1cbbe182f7bf99e26a6e9309411f3fb28ab3` loaded into web and the ordinary workers; source hashes of store/jobs/schema and both migrations match the worktree. Both migrations are applied, web is healthy, and the Chromium admin-route boundary case passed 1/1. This corrects the earlier wrong-checkout Docker evidence. No capture UI or real-photo acceptance is implied.

## Capacity correction and private photo intake evidence (2026-09-27)

Phone admission uses remaining location/section capacity when configured. Without capacity, the batch is open-ended and displays a running count; users may choose a manual limit. The PostgreSQL fixture now explicitly reserves slot 301 in an unlimited session. The 72-card fixture only demonstrates one configured capacity.

The photo intake batch adds authenticated private JPEG/PNG/WebP uploads (10 MiB and 36 MP maximum), immutable hash-verified files, durable upload replay and retake generations, and immediate bounded canonical-image jobs. Initial storage safeguards are 1 GiB per session, 4 GiB per owner and a 2 GiB free-space reserve; these are byte safeguards, not fixed card-count limits. HEIC has an explicit JPEG/in-app-camera alternative. Originals are retained unfinished; the chosen seven-day post-commit cleanup is pending the commit implementation.

The reusable full local verifier passed with report `acquisition-2026-09-27T15-29-22-191Z`. Real PostgreSQL cases cover concurrent replay, conflicting keys, rollback after file persistence, duplicate-looking physical cards, generation fencing, stop/drain, authorization and actual Sharp preparation. Inventory remains unchanged.

Explicit worktree Docker build and reload passed. `verify:local-image` matched all 389 build inputs against loaded image `sha256:ed15723b8b39abafbf2ef329363a20ebdb0474e6887d7b3c91de17c19a019fa6`. The focused local browser test passed 1/1 in 13.5 seconds: capacity-two destination, lost-ACK reload recovery, fake camera capture, full-batch admission block, retake preserving physical count, private-photo access denial, 390/320px layouts, and an unknown-capacity batch with a running count and continued admission. The screenshot was inspected. This proves Chromium behavior with a generated image and fake camera, not real Android camera acceptance.

Review entry point: `/imports/scan`. Local worker overlay: `docker-compose.acquisition.local.yml`, combined with the ordinary local Compose files. The source manifest helper prevents accidentally reviewing an image built from a different checkout. Ten supplied private Android originals remain untouched; real recognition/corpus checks remain pending. Card identification, review, Inventory commit, secure Android connection and backup/restore acceptance remain incomplete. No production change.
