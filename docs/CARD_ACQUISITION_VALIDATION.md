# Card acquisition validation and release gates

**Future test plan only.** No capture functionality, drivers or corpus tests were installed/run by this planning task. Read [milestones](CARD_ACQUISITION_MILESTONES.md) for dependencies and [architecture](CARD_ACQUISITION_ARCHITECTURE.md) for semantics.

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

Use the same test IDs and privately stored ground-truth corpus for fi-6130Z, then optional fi-7160/fi-8170. Begin with low-value bulk cards. The first device's archived vendor specification supports duplex, ultrasonic multifeed and ID-card handling, but its card note describes up to three continuous cards; A4 paper capacity/speed is not a guarantee for a 100-card MTG load. [Ricoh specification](https://www.pfu.ricoh.com/global/scanners/fi/discontinued/fi6130z/fi6130z.html).

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
