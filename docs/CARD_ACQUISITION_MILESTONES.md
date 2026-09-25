# Card acquisition executable milestones

**All implementation phases are PLANNED / NOT STARTED / ON HOLD.** The user approved planning, not execution. Current bug fixes and UI consolidation retain priority. [Roadmap](CARD_ACQUISITION_PLAN.md) establishes order; [architecture](CARD_ACQUISITION_ARCHITECTURE.md) defines shared invariants; [validation](CARD_ACQUISITION_VALIDATION.md) defines gates. GitHub issues mirror these work packages and own live status.

Each phase below includes PR-sized batches. Begin a future session by reading its issue, this phase, relevant architecture sections and live checkpoint; the original 2,000-line report is optional background. Preserve the current four-user ownership model, 150,000-copy inventory scale, existing URLs and ordinary advisory capacity behavior. Every implementation PR requires local evidence, required CI and individual merge approval.

## P0 — Planning baseline

- Purpose: preserve design and build an actionable repository-specific backlog.
- Prerequisites: supplied prompt/report, repository/Foundry inspection and live GitHub reconciliation.
- Scope: this document set, archived inputs, architecture decisions, deferred milestone/issues, Foundry summary and documentation PR.
- Non-goals: application code, schema/migrations, dependency installation, UI, native drivers, Docker/data changes or scanner purchase.
- Acceptance/tests: every requested area maps to an inspected source or future gate; links/scope verified; questions and deviations explicit; Core check on documentation PR. No new functional coverage claimed.
- Risks/unknowns: source observations can differ from older wiki/report claims; re-inspect before starting.
- Hardware: none. Gate: user can review a coherent deferred plan.

## P1 — Session domain, counting and persistence

- Purpose: give all providers a small shared business model with reliable identity.
- Prerequisites: explicit start authorization; revisit current queue and P0 architecture.
- Batch 1: pure TypeScript DTOs/capabilities, state reducer, target allocation and count reconciliation; reuse existing storage-layout arithmetic. Unit fixtures only.
- Batch 2: additive Prisma session/run/event/candidate/observation records and indexes; actor/User versus owner/Player scope; durable revisions and retry identities. Introduce the smallest transaction-aware storage summary adapter.
- Non-goals: real files, OCR, live catalog, commit endpoint, scanner/device package, mobile/hopper stubs.
- Acceptance: duplex 2→1; multi-card 1→6; recognition failure never changes physical count; zero/unknown/full/over-capacity are distinct; selected-section capacity respects overall bound; unsupported capabilities rejected; invalid phase transitions and cross-owner actions rejected.
- Tests: `tsx --test` behavior tests; real PostgreSQL migration/uniqueness/ownership and concurrent event receipt tests in explicitly opted-in local fixture runner. No source-string-only substitute for invariants.
- Risks/unknowns: finalize optimistic revision/state representation and manual split/merge reconciliation before persistence; avoid single enum conflating parallel phases.
- Hardware: none. Gate A: domain/copy accounting and durable identity proven. Follow-on: P2/P3; catalog preparation can begin after this gate.

## P2 — Fixture provider and durable orchestration

- Purpose: establish a deterministic, hardware-free reference for provider behavior and recovery.
- Prerequisites: P1; notification delivery lease pattern reviewed.
- Batch 1: versioned manifest provider, deterministic clock/fault schedule, run commands/events, target enforcement modes and replay/out-of-order ingestion.
- Batch 2: persisted bounded processing jobs, fenced leases/retries/heartbeat, restart and stale-work recovery; serial repeatable DB fixture command wired into release evidence.
- Non-goals: TWAIN, image recognition, simulated measurements presented as hardware throughput, general-purpose queue platform.
- Acceptance: exact mode acquires 263 and leaves 37 untouched from 300; best-effort mode can retain 263 allocated plus 37 overflow. Recognition failure at #147 does not refill a slot. Replayed events/START do not add candidates; restart and reversed delivery do not change identity or allocation. Cancellation preserves accepted artifacts/cards; source exhaustion below target is explicit.
- Tests: missing sides/gaps, duplicate identity with different payload, lease theft/stale completion, network ACK loss, paused/failed/cancelled runs, restart mid-event and two competing workers. Verify counters recompute from durable records.
- Risks/unknowns: refills must not recapture a previous physical item; overflow cannot be conflated with untouched source items. No in-memory-only correctness.
- Hardware: none. Gate B: target and replay integrity; P2 harness is reused throughout later phases.

## P3 — Artifact storage and Image Batch acquisition

- Purpose: safely accept real images as a useful provider, independent of recognition.
- Prerequisites: P1, P2 harness; choose upload/disk/retention/backup limits before accepting real personal files.
- Batch 1: private capture namespace under existing upload root; temporary/final file protocol, hashes, ownership-aware retrieval, format/size/pixel limits and per-owner/session quotas.
- Batch 2: file picker/drag-drop/API input as an Imports task, persisted upload order and progress, retry-safe finish/ACK, duplicate-upload warning and orphan reconciliation; backup inclusion check.
- Non-goals: card detection in provider, browser arbitrary-directory watcher, remote-image URLs, cloud/object-storage platform or desktop sync application.
- Acceptance: validated JPEG/PNG/WebP survive refresh/restart; unsupported HEIC gives an actionable message until explicitly supported. Same upload identity retries return one artifact; identical bytes under different physical IDs do not discard cards. Disk-full/interrupted writes never become READY. Raw/crop/thumbnail URLs enforce owner/admin access.
- Tests: forged MIME, decompression/pixel limits, path/symlink traversal, duplicate/reordered uploads, interrupted rename/DB write, unauthorized reads, cleanup race, private backup/restore with existing uploads.
- Risks/unknowns: actual phone file formats, proxy limits, storage budget, retention duration. Explicit image deletion policy must preserve unresolved/overflow lineage.
- Hardware: none. Gate: real image inputs durable and bounded, no inventory writes. Manual file transfer from phone is sufficient.

## P4 — Detection and canonical images

- Purpose: turn one or many observations into usable source-independent card images and reconciled physical counts.
- Prerequisites: P2/P3; labeled small representative image corpus.
- Batch 1: evaluate local decoding/geometry dependencies against real Linux image/Windows dev constraints; implement orientation/crop/resize/quality/thumbnail stage with versioned inputs/outputs.
- Batch 2: multi-card detection, manual add/remove/adjust region and explicit observation-pair correction; stable spatial ordering and count/target recalculation.
- Non-goals: Magic recognition inside providers, AI condition/finish grading, arbitrary clutter/occlusion guarantees, mobile/video tracking implementation.
- Acceptance: single-card→one; six-card photo→six with raw provenance; duplex front/back→one; missing side remains uncertain. Rotation/perspective crops retain title/footer. Manual repair handles missed/extra/overlapping detections without losing evidence. Reprocessing cannot duplicate candidates or overwrite reviewed decisions.
- Tests: modern/old/borderless/DFC cards, dark/light backgrounds, glare, blur, rotated/perspective/multi-card photos, background rectangles, clipped corners, identical-looking copies, stable ordering independent of worker completion.
- Risks/unknowns: choose OpenCV/native/WASM or another geometry library only after memory/performance/license evaluation. Define an initial supported photo envelope (separated, visible cards); outside it requires review/rephotograph, not fabricated detection confidence.
- Hardware: none. Gate C: labeled geometry/count outcomes and safe manual recovery proven.

## P5 — Local catalog and exact-printing recognition

- Purpose: local printing proposals with explainable evidence and conservative automatic acceptance.
- Prerequisites: P1 for catalog preparation; P4 for actual OCR; corpus and supported language policy.
- Batch 1: streaming explicit admin bulk-maintenance job, existing Card normalization/upsert adaptation, nonunique indexes, refresh coverage/version metadata, resumable failure handling and query performance checks. Default English dataset first; non-English completeness remains explicit.
- Batch 2: evaluate local OCR engines on title/collector regions; select pinned runtime/model; persist attempts, signals/contradictions/quality/version; implement pure candidate resolution and review gates.
- Batch 3: offline reproducible benchmark with held-out printings, error analysis and proposed promotion thresholds. Keep auto-accept disabled until gate approved.
- Non-goals: per-card live API loop, second card catalog/database, arbitrary similarity thresholds, fuzzy-name automatic selection, artwork embeddings/mandatory cloud AI.
- Acceptance: no external request for catalogued cards; name-only always review; collector suffixes/language/face aliases preserved; weak or conflicting evidence cannot auto-accept; incomplete catalog does not create false uniqueness. Manual decisions survive new worker attempts; unknown finish remains independent from printing recognition.
- Tests: tiny bulk fixture to real Card records, interrupted refresh/retry and existing FK preservation, non-English/variants/DFC/name contradictions, actual OCR labeled corpus separate from mocked logic tests, no-network normal recognition run, broad-catalog lookup timing at intended scale.
- Risks/unknowns: corpus coverage and calibrated precision; engine startup/RAM; index/JSON growth; current unique mtgjsonUuid interactions; all-language bulk scope. Verify current Scryfall guidance before implementing loader.
- Hardware: none. Gate D: measured precision/review/coverage metrics with no observed wrong auto-accepts in held-out release corpus. Report sample sizes; do not promise population accuracy.

## P6 — Review workspace and explicit physical reconciliation

- Purpose: make an image session useful and understandable before inventory commit is enabled.
- Prerequisites: P4/P5; existing Imports task shell, resolver dialog, CardSearch and StorageDestinationPicker reviewed.
- Batch 1: persistent session list/deep links/progress; paged review with capture/proposed printing, reason/evidence display, local search and per-card accept/change.
- Batch 2: explicit batch finish/language/condition/opener defaults and per-card overrides; needs-review/conflict/no-match/unknown-finish/quality/overflow filters; manual physical-count correction and clear destination assignments.
- Batch 3: selected subset preview, unresolved/set-aside/overflow conservation, keyboard/focus/phone/theme acceptance. Same-session reassignment first; cross-session transfer is optional later and must preserve candidate identity.
- Non-goals: implicit inventory writes, automatic foil grading, a new global topbar provider menu, treating skip as disappearance of a physical card, unbounded image loading.
- Acceptance: reviewer sees why a proposal exists, explicitly chooses required attributes, can retain excess pending or assign elsewhere, and can resume after refresh. Pending physical cards and ready-to-commit cards have separate totals. Multi-user stale edits are rejected/rebased visibly. Opening or leaving review never commits.
- Tests: Playwright desktop 1366×768, phone 390/320, six themes, keyboard/Escape/focus restoration, conflict revision, owner/admin and private file access, missing worker, empty/no-match/overflow states; bounded list at hundreds of candidates.
- Risks/unknowns: photo spatial order may differ from user's physical stack; display stable reference/crop order and let the user reconcile. Final URL/task naming fits existing Imports without removing CSV.
- Hardware: none. Gate: complete review workflow; commit still disabled until P7.

## P7 — Shared receipt writes and transactional inventory commit

- Purpose: add confirmed physical copies exactly once with complete lineage and fresh capacity decisions.
- Prerequisites: P2/P6; separately tracked importer atomicity/audit gap reconciled; design inventory writer coordination before enabling capture commits.
- Batch 1: extract/strengthen shared transaction-aware receipt helper for explicit owner/opener/printing/attributes/provenance; existing CSV/manual compatibility tests and auditable effects; preserve notes/source/pull/round/lot distinctions and exact quantities.
- Batch 2: common deterministic location coordination for occupancy/layout-changing import, inventory, move, trade, deck and location paths. Preserve ordinary advisory capacity semantics. Prove this against actual concurrent writes, not just capture-versus-capture.
- Batch 3: receipt/request-key/payload digest, unique candidate membership, immutable reviewed input, all-or-nothing bounded commit + audits; no network calls in transaction. Support explicit selected subset; pending candidates remain staged.
- Batch 4: fresh capacity preview and explicit overfill confirmation bound to current revision/occupancy; reassignment and partial alternatives; UX refresh after commit.
- Non-goals: replacing InventoryItem, global hard capacity, stock reservations for every draft session, uncontrolled merge of existing provenance lots, automatic undo of traded/deck-committed stock.
- Acceptance: retry/double click/new key cannot duplicate candidates; failure leaves zero partial inventory effects; group quantities sum exactly to committed physical candidates. 263→258 race prompts; override commits only after fresh confirmation and audit, reassignment preserves five pending. Changed owner/finish/layout/review preview invalidates old confirmation. No unrecognized/defaulted UNKNOWN finish is silently committed.
- Tests: real PostgreSQL simultaneous commit/import/manual/trade/move/layout-write races; failure injected at each inventory/audit/receipt step; quantity >999 preservation; provenance/notes/source/opener distinctions; replays after response loss; cross-user denial; repeated capacity overrides with fresh preview; full existing mutation regressions.
- Risks/unknowns: all writer coverage and deadlock ordering; bounded retry policy and transaction length; extract only common semantics, do not refactor unrelated app domains. Source-identified importer defects must have independent evidence and fix scope.
- Hardware: none. Gate E: atomicity, quantity, provenance, authorization and capacity integrity demonstrated.

## P8 — Image release acceptance and recovery

- Purpose: deliver a complete independently usable image-upload release before scanner work.
- Prerequisites: P3–P7 and gates A–E; production storage/retention choices settled.
- Batch 1: cross-layer image lifecycle Playwright/DB/corpus evidence, performance measurements for 100-card normal and 300-card stress sessions, bounded paged reviews in 150,000-copy/four-owner fixture.
- Batch 2: worker and server restart, disk-full/backpressure, cancellation/cleanup, backup/restore quiescence/watermark, missing file repair, owner quotas and diagnostics redaction.
- Batch 3: operator docs, migrations/worker deployment/disabled-provider behavior, private fixture packaging and release checklist; review images on actual local Docker.
- Non-goals: requiring a scanner, changing production without separate deployment authorization, claiming generic CI covered a private corpus or Windows behavior.
- Acceptance: upload→process→review→explicit commit→inventory/audit works offline after catalog load; all quantities conserved; no unknown silent defaults; restore yields explainable artifact/receipt state. Every gate has exact revisions, denominators and logs. Core, full local verify and new integration/corpus gates pass with no fixture leakage.
- Tests: [validation plan](CARD_ACQUISITION_VALIDATION.md), existing snapshot recovery drill extended for capture, serial multi-user browser fixture and resource caps. Confirm optional workers can be absent without breaking existing browsing.
- Risks/unknowns: actual storage cost and review labor; record measured throughput and p95 times before deciding targets. Existing appdata consistency limitations must be addressed, not hidden.
- Hardware: none. Gate I: image-only release ready for individual PR/release review. Scanner integration follows independently.

## P9 — Windows agent transport, spool and diagnostics

- Purpose: connect a Windows USB host to separately hosted Archive without a localhost browser API.
- Prerequisites: P1/P2/P3 contracts, image release P8, TLS/trust and user-session packaging decisions.
- Batch 1: scoped pairing/revocation, server-owned session assignment, versioned commands/events, replay-safe fake backend and app status.
- Batch 2: durable private spool, file/event ACK replay, run fencing, local target budget/backpressure, offline/reconnect handling and device lease; diagnostic export redacted by default.
- Batch 3: Windows credential storage/distribution/updates and mock-backend integration tests; agree native runtime based on later adapter needs.
- Non-goals: real TWAIN, unrestricted command execution, inventory commit scope for agent, inbound listener/browser-loopback route, new mobile app.
- Acceptance: forged/expired/revoked/cross-owner credentials fail; repeated START never restarts feed; server restart/disconnect preserves evidence; server restore generation mismatch forces reconciliation; bounded spool exhaustion requests local stop. No tokens/full paths/images in default diagnostic bundle.
- Tests: mock backend→actual agent transport→local API/database, credential lifecycle, ACK loss/out-of-order, malicious payload/path, command duplication and server-epoch changes, signed update integrity if used.
- Risks/unknowns: .NET versus alternative native host, secure installer/update signing, x86/x64 choice, LAN TLS certificate enrollment; decide here rather than install speculative libraries now.
- Hardware: Windows computer only. Gate: secure recoverable agent transport; no hardware validation claim.

## P10 — TWAIN adapter and virtual-source proof

- Purpose: prove real native acquisition before purchasing/receiving scanner hardware.
- Prerequisites: P9; compatible chosen Windows process, DSM, virtual source and backend library; record versions/licenses.
- Batch 1: isolated TWAIN backend, source enumeration/capability negotiation, native UI/message-loop lifecycle, transfer status/error/pending handling and side/boundary uncertainty.
- Batch 2: actual official software-only source→actual DSM→agent→server session transfers, local stop/cancel, clean close/reopen and diagnostic bundle.
- Non-goals: mocking this gate, assuming virtual source supports every requested capability, asserting paper behavior from software, adopting x86 before compatibility evaluation.
- Acceptance: source opens/transfers real bytes; run target causes a local stop request; processing/review reached without inventory mutation; 100 sequential sessions cleanly close/reopen; interrupted process recovered. Unsupported duplex/document boundaries explicitly listed and covered by fixture tests only.
- Tests: one/many transfers, unsupported setting and requested-vs-actual mismatch, stop/cancel and pending drain, UI suppression if advertised, 100-run repetition, process kill, source removal/error/status diagnostics.
- Risks/unknowns: older sample installer/build compatibility with current Windows; wrapper maintenance and native ABI/threading; virtual source may lack reliable sheet/side metadata. Any gap is a qualification limitation, not permission to count images as cards.
- Hardware: Windows host; no scanner. Gate F: real software TWAIN integration proven within advertised capabilities.

## P11 — fi-6130Z physical characterization

- Purpose: characterize the actual scanner using existing software and a fixed corpus.
- Prerequisites: P8/P10, actual fi-6130Z and supported PaperStream/OS/source combination, low-value expendable cards.
- Batch 1: driver/source inventory, negotiated settings/counters, safe single-card/simplex/duplex baseline and before/after surface inspection.
- Batch 2: controlled 10/25/larger batches only after smaller tests are safe; target 1/2/5/arbitrary N with card N+1 position recorded; multifeed/jam/order/duplex/blank-suppression tests.
- Batch 3: compare 300 DPI against supported alternatives, crop/rotate/color profiles, throughput/image bytes/OCR quality and rollers/consumable counters; publish measured profile and limitations.
- Non-goals: guarantee a 100-card feeder load, surface safety from vendor ID-card specs, exact physical stop from transfer count, routine use of valuable cards in characterization.
- Acceptance/tests: [hardware matrix](CARD_ACQUISITION_VALIDATION.md#hardware-matrix) completed with attempts/failures and images retained privately; reliable pairing and honest overscan handling; no silent lost physical cards; record visible marks and stop testing damaging configurations. Gate may conclude device unsuitable.
- Risks/unknowns: feed material, wear, sleeves (outside baseline), driver/OS support, physical transport latency; native boundary ambiguity can prevent accurate automatic target enforcement.
- Hardware: actual fi-6130Z. Gate G: supported operational profile and measured safety/stop limitations, or documented no-go.

## P12 — Optional scanner-family qualification

- Purpose: compare fi-7160/fi-8170 with the same workload without changing the core model.
- Prerequisites: P11 matrix; explicit later decision and access to each device.
- Scope/batches: per-device driver/bitness capability profile, exact same corpus/test IDs, measured performance/order/stop/surface comparison; isolate adaptations behind backend/profile.
- Non-goals: auto-certified compatibility based on family name, purchase recommendation without current evidence, redesigning recognition/inventory per scanner.
- Acceptance/tests: report throughput, failures/1,000 with raw sample sizes, marks, multifeeds, overscan count/distribution, pairing errors, review rate and bytes/card; retain unsupported capability caveats.
- Risks/unknowns: availability, firmware/source differences and real feeding behavior. No estimate or due date until hardware exists.
- Hardware: actual fi-7160 and/or fi-8170. Gate: per-device qualification, optional and not blocking image or fi-6130Z delivery.
