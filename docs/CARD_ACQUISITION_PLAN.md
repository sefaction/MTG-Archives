# Card Acquisition Framework roadmap

**PLANNED / NOT STARTED / DEFERRED behind current bug fixes and UI consolidation.**

Planning baseline: `bfb7be8`, reviewed September 22, 2026 (America/Chicago; September 23 UTC). This document and its backlog authorize planning only. Starting implementation requires a later explicit user decision. GitHub issues/PRs remain authoritative for live status; Foundry holds the durable roadmap summary.

## Confirmed product decisions

- First usable release: image uploads through processing, review, and explicit inventory commit; scanner integration is a later release.
- Primary collection: mostly English, loose unsleeved cards. Typical sessions are up to about 100 physical cards. This is a workload baseline, not an artificial database limit or a promise about feeder capacity. Keep 300-to-263 as a deterministic stress case.
- Future scanner plugs into a Windows laptop/desktop; Archive runs on Unraid or another server. Plan an outbound Windows agent.
- Capacity remains advisory. Acquisition rechecks room before commit; a shortfall requires reassignment, leaving excess pending, or a fresh **explicit over-capacity override** recorded in the audit. Never silently overfill.
- No additional playtest changes are part of this initiative.

## Outcome and boundaries

Acquire physical cards from fixtures, uploaded images, then TWAIN without coupling recognition to a device. An image may show several cards; duplex images may describe one card. Count physical candidates independently from image count and recognition success. Review precedes any inventory mutation.

The image release includes single-card and multi-card photos, manual detection correction, local exact-printing proposals, unknown-finish review, retained overflow, retry-safe processing and transactional commit. A session is not a way to rescan existing inventory as new stock without acknowledgement; accidental repeated uploads require review, not automatic physical-card deduplication.

Initial exclusions: camera/live video, mobile app/sync, hopper/motors, foil or condition AI, pricing/valuation, artwork embeddings unless separately justified, generalized document storage, mandatory cloud AI, and production deployment during planning. Watched folders are a later image-input adapter, not a browser filesystem assumption.

## Read and execute

1. [Architecture and repository findings](CARD_ACQUISITION_ARCHITECTURE.md): what to reuse, what must change, invariants and decisions.
2. [Executable milestones](CARD_ACQUISITION_MILESTONES.md): prerequisites, bounded batches, non-goals, acceptance, tests and risks for every phase.
3. [Validation and hardware gates](CARD_ACQUISITION_VALIDATION.md): software corpus, integrity, recovery, recognition and hardware evidence.
4. [Reference archive](reference/card-acquisition/README.md): original user prompt/report and independently checked primary sources. The research report is not the implementation specification.

## Delivery sequence

| Phase | Deliverable | Prerequisites | Exit gate |
| --- | --- | --- | --- |
| P0 | This plan, source review and deferred backlog | Current task | Reviewable plan; no feature implementation |
| P1 | Domain contracts, counting, persistence and ownership | Explicit start decision | A: artifacts and physical candidates remain distinct |
| P2 | Deterministic fixture orchestration and restart-safe work | P1 | B: 300/263, replay, overflow and recovery |
| P3 | Private artifact storage and Image Batch input | P1; use P2 harness | Safe/retryable real file input |
| P4 | Detection, canonical images and count reconciliation | P2, P3 | C: correct crops and physical counts on labeled fixtures |
| P5 | Local catalog and conservative recognition | P1; P4 for OCR | D: measured exact-printing quality; contradictions veto acceptance |
| P6 | Persistent review, evidence, finish and overflow | P4, P5 | Review is complete and useful without committing |
| P7 | Shared inventory write boundary and transactional commit | P2, P6; capacity writer coordination | E: quantity, audit, capacity and retry integrity |
| P8 | Image-release recovery, scale and operational acceptance | P3–P7 | I: image workflow independently releasable |
| P9 | Paired Windows agent, spool and diagnostics | P1, P2, P3; sequenced after image release | Secure recoverable transport; no scanner required |
| P10 | TWAIN adapter and real virtual-source POC | P9 | F: actual DSM transfers and stop lifecycle |
| P11 | fi-6130Z characterization | P8, P10, actual device | G: measured feeding, pairing, quality and stop behavior |
| P12 | Optional fi-7160 / fi-8170 validation | P11; separate decision | Same matrix, documented device-specific outcomes |

Catalog preparation in P5 can run after P1 independently of P4, but OCR acceptance depends on canonical images. Early security, durability, backups and diagnostics are required within each relevant phase; P8 validates them together rather than postponing them until the end. Each milestone contains smaller PR-sized batches. Do not equate one milestone with one large PR.

## Before and after hardware

Before owning a scanner: all image functionality, session/count/capacity rules, replay safety, processing, local catalog/OCR, review, commit/audit, backups, agent protocol/spool and actual virtual TWAIN integration can be built and tested. A Windows host is needed for P9/P10, but physical scanner hardware is not.

Hardware remains necessary for PaperStream/OS/source compatibility, real feed safety and reliability, multifeed/jam handling, physical order, duplex metadata, negotiated DPI/crop behavior and whether card N+1 enters the transport. Virtual transfers cannot prove those claims. A session of 100 cards may require several safe feeder loads.

## Open decisions at the right time

**Before starting P1:** explicitly start this deferred initiative, reconcile the active bug/UI queue, and review the proposed partial-commit/count-correction semantics in the architecture. The recommended first batch below does not need an OCR engine or scanner purchase.

**Before the relevant phase:** settle retention/disk/backup limits before enabling real uploads (P3); validate corpus rights and supported image/language formats (P3–P5); choose image/OCR runtimes and recognition promotion criteria with measured data (P4/P5); approve the commit writer-coordination implementation (P7); choose Windows runtime/bitness, packaging, signed distribution and trusted server/TLS setup (P9/P10). Unknowns have owners and exit gates in the milestone document; they do not block writing this plan.

## Eventual first implementation batch

When explicitly started: implement only pure TypeScript capture contracts, phase transitions, count/target reducers and deterministic unit fixtures in existing `lib`/`tests` conventions. Prove two duplex artifacts count as one physical candidate, one six-card artifact maps to six candidates, unreadable card #147 still counts, zero remaining room prevents starting a fill session, and replay does not increment counts. No image dependencies, DB migrations, UI or scanner work in this first batch. Follow with additive persistence and ownership in a second P1 batch.

## Planning validation and live backlog

This task changes documentation and GitHub planning records only. Validate references, coverage and diff scope, then use the normal PR/Core verification gate. Do not rebuild Docker, install dependencies, modify schema/data, or claim new acquisition tests passed. Future implementation uses `npm run verify` plus the dedicated DB/corpus/Windows gates described in the validation plan.

Live backlog: [umbrella #302](https://github.com/sefaction/MTG-Archives/issues/302), [milestone 3](https://github.com/sefaction/MTG-Archives/milestone/3). All twelve implementation work packages carry `on hold`:

| Phase | GitHub work package |
| --- | --- |
| P1 | [#303 — Domain and persistence](https://github.com/sefaction/MTG-Archives/issues/303) |
| P2 | [#304 — Fixture and orchestration](https://github.com/sefaction/MTG-Archives/issues/304) |
| P3 | [#305 — Artifacts and Image Batch](https://github.com/sefaction/MTG-Archives/issues/305) |
| P4 | [#306 — Canonical image pipeline](https://github.com/sefaction/MTG-Archives/issues/306) |
| P5 | [#307 — Catalog and recognition](https://github.com/sefaction/MTG-Archives/issues/307) |
| P6 | [#308 — Review](https://github.com/sefaction/MTG-Archives/issues/308) |
| P7 | [#309 — Transactional commit](https://github.com/sefaction/MTG-Archives/issues/309) |
| P8 | [#310 — Image release acceptance](https://github.com/sefaction/MTG-Archives/issues/310) |
| P9 | [#311 — Windows agent](https://github.com/sefaction/MTG-Archives/issues/311) |
| P10 | [#312 — Virtual TWAIN](https://github.com/sefaction/MTG-Archives/issues/312) |
| P11 | [#313 — fi-6130Z qualification](https://github.com/sefaction/MTG-Archives/issues/313) |
| P12 | [#314 — Optional scanner families](https://github.com/sefaction/MTG-Archives/issues/314) |

Source review also recorded [bug #301](https://github.com/sefaction/MTG-Archives/issues/301): existing CSV commit lacks an atomic receipt/status/audit boundary. This is a separate bug-fix queue item, not acquisition implementation; no runtime fault injection or fix occurred here. Reconcile it before P7.

Existing #262–#274 remain the UI initiative; #260/#269/#270 were closed before this planning task. No old issue is reopened merely to create this roadmap.
