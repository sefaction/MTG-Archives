# MTG-Archive — Card Acquisition implementation kickoff for Codex

## Authorization and task boundary

**I am explicitly authorizing phased implementation of the Card Acquisition Framework now. This is no longer a planning-only task.**

I am getting a **Fujitsu/Ricoh fi-7160**, but I do not have it yet. Its absence must not block the hardware-independent work. Document-scanner acquisition is one supported path, not the foundation that every other path waits for. Phone capture, uploaded photos, and location-bound image intake are real product deliverables.

In this task, reconcile the existing roadmap with the requirements below, then **implement and verify the first bounded foundation batch described in “Begin implementation in this task.”** Do not stop after producing another plan or ask me to authorize starting the initiative again. If that batch has already landed, report the live evidence and select the next smallest dependency-ready hardware-independent batch under the repository's normal workflow; do not recreate completed work.

This authorization supersedes previous user-imposed “planning only,” “on hold,” “awaiting start approval,” and “wait for scanner” restrictions for this initiative. It does **not** waive repository instructions, ownership/security boundaries, verification, individual PR review, merge approval, or deployment approval. Do not merge PRs, deploy to production, or change production data. Preserve unrelated work.

Use the normal development branch/PR workflow. If the planning PR remains unmerged, read its current documents and establish a safe working branch without silently merging it or overwriting newer work. Do not let a historical planning-only banner substitute for assessing actual code and dependency prerequisites.

After reconciling live status, record the initiative as authorized/active using the established project conventions. Mark only work actually begun as in progress; later milestones remain queued. Remove stale waiting-for-user or waiting-for-hardware blockers only where this authorization and the actual dependency graph resolve them. Do not claim every phase is underway or complete.

Normal scoped code, tests, and documentation changes are authorized. Dependencies, local migrations, or local worker configuration may be introduced when a selected implementation batch genuinely requires them and its safety/verification requirements are met. Do not install the entire proposed future stack in advance. The first batch below deliberately requires no OCR, GPU, native scanner libraries, database migration, or new service.

Use the existing project-planning system rather than creating a competing roadmap. At the reviewed snapshot, the umbrella was issue #302; phases were #303–#314; the documentation was in PR #315 on `docs/card-acquisition-plan`. The reviewed documentation head was `cc4ca2435969c00b0dc373c92f7ff8a8b829e39a` and main baseline was `7ba9399cd5702f2c2240a9ade80be45e72b559df`. These are audit anchors, not instructions to overwrite newer work. Fetch the live state before editing.

Read AGENTS.md, CODEX.md, the current checkpoint, relevant issues/comments, and all four acquisition planning documents. Inspect the current inventory, import, storage, ownership, jobs, upload, deployment, backup, and test boundaries. Limit initial investigation to what is needed to reconcile this scope and safely begin the selected batch; do not turn the kickoff into an indefinite research or architecture exercise.

## Updated product requirements

1. The user is definitely obtaining a **Fujitsu/Ricoh fi-7160 for testing**, but does not have it yet. Make it the primary hardware characterization device once available. fi-6130Z and fi-8170 are optional compatibility targets, not prerequisites. Gate only actual physical-device tests on scanner availability.
2. Deliver a usable card-digitization path without purchasing a document scanner. Browser image upload, including direct phone photo upload, is the baseline.
3. Phone scanning is now an explicit product deliverable, not merely an interface reserved for a speculative native app. Plan direct camera/photo upload first, then a live browser/PWA scanning workflow. A native mobile app and fully disconnected recognition can remain deferred.
4. Support location-bound image intake: upload directly into a selected MTG-Archive location/section, and provide a separately scoped server/agent inbox adapter for an approved filesystem folder.
5. Preserve document-scanner acquisition through a Windows agent. Webcam and eventually a motorized hopper must fit the same capture/session contracts.
6. The user is willing to dedicate a GPU on the Unraid server if measurements justify it; no GPU model, allocation, or working accelerated runtime is confirmed. Support an optional accelerated recognition worker while retaining a useful CPU-only deployment and no mandatory paid/cloud AI service. GPU procurement or availability must not block foundation, upload, review, or CPU-baseline development.
7. Accuracy means exact supported printing and language, correct physical-copy count, correct location/section placement, and retry-safe inventory effects—not merely recognizing the card name.

Do not describe all these as already implemented or empirically proven. The audit examined source and plans; it did not benchmark recognition or test scanner hardware.

## Keep the strong existing foundation

Retain provider-neutral ingestion; artifacts distinct from physical candidates; many observations per candidate; multiple candidates per artifact; explicit uncertainty for missing boundaries; durable retries and fenced workers; immutable recognition attempts; manual-decision precedence; private artifacts; transactional, auditable, idempotent commit; and advisory capacity with fresh explicit overrides.

Preserve ordinary inventory and League semantics. Do not create a second authoritative inventory or card catalog. A derived visual index or model cache is not a second source of truth: key it to existing Card/Scryfall/face identity and version it.

Reinspect importer reuse. Issue #301 was closed, and the reviewed main branch already contains `lib/import-commit.ts` with serializable retry and audit writes. Update historical assertions that import commits are still non-atomic. Do not infer that this automatically solves acquisition provenance, unknown attributes, or all-writer capacity coordination. Existing source/notes/default/grouping behavior still needs compatibility review.

## Required roadmap amendments and implementation requirements

Carry these requirements into the existing milestones. They define the overall initiative; they are not an instruction to implement every subsection in the first PR.

### A. Session intent and physical identity

Make session intent explicit. The initial shipped action may remain ADD_NEW, but the UI must clearly distinguish it from identifying/auditing cards already recorded. Reserve a documented path for AUDIT_EXISTING/RECONCILE and explicit MOVE_EXISTING workflows; do not implement destructive reconciliation as an implicit side effect of an upload.

A detected or recognized existing printing does not prove which owned physical copy is present. Comparing hashes does not establish physical identity. A repeated delivery of one artifact is a transport retry; two identical-looking cards may be two legitimate copies. In continuous camera capture, use a capture-episode boundary, removal/rearm, explicit confirmation, or a hardware-cycle identity. A cooldown or name-based deduplication alone is insufficient.

Record count certainty and provide manual correction. Double feeds, missed detections, occlusion, and missing duplex sides cannot be fixed by pretending every two images form one card.

### B. Location-aware intake and placement

Plan a versioned placement/allocation concept with selected owner, location, section, layout revision, capacity snapshot, ordered physical candidates, pending assignments, overflow, and explicit destination changes. Adapt this to the real storage schema rather than forcing new normalized section tables.

Use the tighter known selected-section and overall-location bound. Preserve null/unknown versus zero/full and current direct-copy versus descendant semantics. Display committed occupancy, this session's pending allocations, and other active sessions separately.

Plan optional ordered multi-section allocation. A digital assignment does not physically move a card: crossing a section boundary must pause or request an explicit placement acknowledgement. Preserve stable batch/stack ranges and do not order by recognition completion time.

Recheck authorization, layout, candidate revisions, and capacity at commit. A changed/removed destination or section invalidates the preview. Excess remains staged or explicitly set aside/reassigned. Recognition failure never frees a physical slot. Retain the audited fresh-overfill option; do not silently turn all existing inventory writes into hard-capacity enforcement.

For concurrent active fill sessions, document whether warnings alone are sufficient or an optional short-lived reservation is justified. Do not claim reservations exist when only pending counts are displayed. Reservations would require separate expiry, crash/reconnect, offline-budget, and all-writer semantics; avoid long database transactions during capture/review.

### C. Phone and webcam capture

Add a deliverable for authenticated phone-browser capture with destination selection, portrait/landscape behavior, camera permissions, HTTPS, supported-device feature detection, photo-library selection, interrupted uploads, and capture progress. Desktop-to-phone QR/deep links may select a session but must not bypass ownership checks or expose long-lived credentials.

Evaluate real iPhone HEIC/HEIF inputs and orientation during the phone milestone. Support a validated decoding/conversion path or state a tested alternative clearly; do not make desktop conversion the assumed universal phone workflow.

For live scanning, plan a quality/stability gate, a selected high-quality still or short bounded burst, one candidate per capture episode, explicit rearm, and clear accepted/pending/needs-recapture feedback. Do not upload every video frame by default. Camera zoom/focus/torch and background/resume behavior require feature detection and actual device tests.

Local buffering is not a guarantee of indefinite offline durability. Do not display uploaded/saved until the relevant durable acknowledgement; define behavior when the tab closes, storage is evicted, permissions change, or the device locks. Fully offline recognition/native synchronization can remain later work.

Webcam capture can share camera-session behavior. A future hopper adds motor/sensor/cycle control; camera detection alone cannot guarantee that exactly one physical card advanced.

### D. Location-bound image inboxes

Create a scoped input-adapter work package, not a generic filesystem crawler. Distinguish the computer folder from the inventory destination.

A saved intake profile should bind an allowed folder or upload endpoint to owner, destination, section, session policy, and explicit defaults. Do not trust filenames or directory strings as authorization.

Specify producer completion/atomic-rename or equivalent upload-finalization protocol, retry identity, periodic reconciliation, quarantine, success acknowledgement, batch boundaries and deterministic ordering. Handle partial copies, overwrites, duplicate notifications, restarts, disk full, invalid images and removed destinations. Never recursively scan arbitrary Unraid shares. Avoid deleting originals until successful durable ingestion and the configured retention policy permits it.

This adapter is also the fallback for scanners/platforms without direct TWAIN integration. Do not require native adapters for every OS to ship a broadly accessible feature.

### E. Recognition strategy: benchmark a hybrid, not an OCR-only architecture

Revise P4/P5 exclusions so visual candidate retrieval can be evaluated now, even if production promotion follows benchmark results. Separate card detection, geometric normalization, text recognition, candidate generation, exact-print verification, and acceptance policy.

Plan a cheap path for clean single-card scans and a more tolerant path for photos. Retain high-resolution originals/regions; generate task-specific derivatives instead of downsampling away tiny collector text. Multi-card photos must meet a documented visible/separated-card envelope, with manual region repair and recapture guidance.

Benchmark at least:
- Tesseract plus structured metadata/name resolution as the CPU baseline.
- PaddleOCR local text-recognition alternatives on CPU and supported GPU profiles.
- Perceptual fingerprint/local-feature candidate comparison.
- An embedding-based top-k image-retrieval path, followed by exact-print validation.

Evaluate OpenCV-style geometric card detection versus a small card-trained corner/segmentation detector on actual input images. Off-the-shelf model names do not prove Magic-card detection support. Record available weights, training data, reproducible preprocessing, runtime and licenses.

Allow visual retrieval across the full supported reference catalog when OCR fails; do not restrict it permanently to an incorrectly narrowed OCR candidate set. Combine candidates from text and image evidence. Artwork identity is not exact printing identity. Preserve ambiguity among same-art printings until discriminating evidence or user review resolves it. Unreadable language, unknown finish/condition, missing catalog coverage, generic backs and unknown cards require explicit states.

Prefer evidence-aware rejection to false certainty. A nearest neighbor is a candidate, not a confidence probability. A single result in an incomplete local catalog does not prove uniqueness. Contradictory evidence must veto automatic acceptance. Do not copy fixed confidence cutoffs from another project without calibration.

Keep catalog/model/image index versions consistent, resumable and rebuildable. Plan reference-image availability and permissible cache/distribution separately from bulk card metadata. Pin all runtime/model versions and preserve review decisions across reprocessing.

### F. GPU-capable Unraid worker

Keep authoritative session, ownership, capacity and inventory decisions in MTG-Archive. A bounded inference worker returns observations/evidence; it cannot grant ownership or commit stock.

Plan CPU and optional GPU deployment profiles behind the same job/result contract. A single optional Python/native worker container is reasonable to evaluate; do not introduce a broad microservice platform. Evaluate NVIDIA/CUDA as the first accelerated target, but verify the actual card, Unraid driver, container runtime, model runtime and VRAM. AMD/Intel compatibility is a separate measured support profile, not implied by a generic GPU flag.

Specify warm-loaded models, bounded concurrency and memory, small latency-aware batches, interactive-versus-bulk scheduling with fairness, explicit GPU-device selection, actual execution-provider diagnostics, out-of-memory handling and transparent CPU fallback or resumable pause. No silent fallback presented as GPU performance. Scanner stop/count budgets remain local to the Windows agent and must not wait for inference or a network round trip.

### G. Benchmark and qualification gates

Extend the existing validation plan; do not replace its strong integrity tests. Begin with deterministic fixture manifests and available, authorized phone/photo captures. Add real fi-7160 scans when the device arrives; do not require them for the initial photo/CPU pipeline. Expand the corpus before making unattended exact-print accuracy claims. The eventual corpus should include real iPhone/Android photos, multi-card scenes, webcam sequences, fi-7160 scans, older layouts, non-English exceptions, identical-art different printings, foil glare, DFCs, unreadable images, generic backs, non-card rectangles, and cards absent from the active catalog. Unavailable device-specific subsets must be reported as not run, not silently passed or replaced with simulated hardware evidence.

Separate tuning and held-out captures by physical specimen/session/device where appropriate. Reference catalog images are legitimate retrieval inputs; held-out query captures and labels must not leak into tuning. Include dedicated unseen-printing/new-set and unsupported-card tests.

Report exact-print+language auto-accept precision and coverage separately, retrieval recall@k, detection/count errors, repeated/missed physical copies, per-source/layout/language results, recapture/review rate, p50/p95 capture-to-result and end-to-end timings, bytes/card, CPU/RAM/VRAM and operator review time. Use the same dataset and fixed acceptance policy when comparing speed. A faster approximate search or lower-precision model must requalify accuracy.

The product metric is correct, physically reconciled, inventoried cards per operator minute—not GPU FPS or lookup latency alone. Report denominators and uncertainty. No README performance claims count as measured MTG-Archive results.

### H. fi-7160 and sequencing

Replace fi-6130Z-first language in #302/#313/#314 and all authoritative plan documents. Preserve historical reference inputs rather than rewriting their history.

Keep image-first product delivery. Schedule scanner-independent agent/protocol and virtual TWAIN work after their actual contract prerequisites, not after every image UI feature merely because the old roadmap serialized them. Once the fi-7160 is available, an isolated driver/physical-characterization and labeled-corpus task may run before full image-release completion. Keep it in its own bounded work package with the normal review gates. Do not wait for hardware to start other providers, and do not equate an early diagnostic spike with a production-ready scanner integration.

Validate OS/driver/DSM architecture, actual capabilities, supported DPI, front/back identity, blank-page suppression, feed safety, scan order, errors, refills and stopping with N+1 loaded. Retain every overscanned artifact. Do not promise exact physical stop based on transfer counts or virtual-source tests. Use expendable bulk cards and stop damaging tests.

## Existing issue mapping

- #302: updated explicit product deliverables and fi-7160 baseline.
- #303/#304: session intent, placement contracts, camera episode identities and processing backend contract.
- #305: direct phone upload plus separately scoped intake-adapter child work.
- #306/#307: comparative geometry/OCR/visual retrieval benchmark, high-resolution evidence, versioned derived indexes and optional acceleration.
- #308/#309: placement reconciliation, scan intent UX, current shared write reuse and capacity coordination.
- #310: CPU/GPU and phone/source-specific end-to-end acceptance, operator throughput and recovery.
- #311/#312: preserve secure outbound Windows agent and real TWAIN qualification.
- #313: primary fi-7160 characterization.
- #314: optional other scanners after the primary device.

Add bounded child work packages for live browser scanning, location-bound folder intake, and the optional accelerated worker where they do not fit existing issue scopes. Do not create redundant umbrella projects.

## Reference projects and documents to verify at evaluation time

These are candidates/reference material, not preselected dependencies or benchmark winners:

- MTG Card Analyzer: https://github.com/dills122/MTG-Card-Analyzer — title OCR, fuzzy candidates, visual fingerprints, abstention and regression methodology; local-first is not necessarily fully offline.
- Local MTG Scanner: https://github.com/McDandle/local-mtg-scanner — phone workflow and collector parsing; do not copy its explicitly unauthenticated LAN deployment model.
- MTG RealTime: https://github.com/pulkit4501/MTG_RealTime — webcam, detection and VGG16/FAISS candidate generation; top-1 distance matching is not calibrated exact-print verification.
- MTGScan: https://github.com/fortierq/mtgscan — image-to-card-list/OCR examples; assess current backend and exact-print limitations.
- Tesseract: https://github.com/tesseract-ocr/tesseract
- PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR
- FAISS: https://github.com/facebookresearch/faiss
- ONNX Runtime providers: https://onnxruntime.ai/docs/execution-providers/
- Browser camera security: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- Unraid NVIDIA driver plugin: https://ca.unraid.net/apps/nvidia-driver-1aax6kn0zkg6t7
- Scryfall bulk-use guidance: https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17
- Ultralytics licensing: https://www.ultralytics.com/license

Review repository code licenses, transitive dependencies, pretrained weight licenses, dataset rights and distribution constraints separately. An MIT wrapper does not relicense all models/dependencies bundled with it.

## Execution sequence and real dependency gates

Do not treat scanner acquisition, GPU installation, every recognition-engine comparison, or a complete native mobile app as prerequisites for starting the framework.

Use the existing phase/issues rather than creating a competing project. Recommended progression:

1. **Start now: foundation and deterministic behavior.** Implement the first bounded batch below, then persistent ownership/session identity and fixture orchestration in subsequent reviewable batches.
2. **First usable path: location-bound uploaded images.** Build private durable uploads from desktop and phone, single-card normalization, a measured local recognition baseline, correction/review, and safe inventory commit. Deliver the smallest honest end-to-end path before making every advanced capture option available. It may begin with well-lit single-card photographs and a clearly stated supported format/layout envelope. Multi-card photos remain a committed image milestone, not a requirement for the first code batch.
3. **Expand the broadly accessible paths.** Add multi-card photo correction, direct phone camera workflow, then live browser/webcam capture and approved location-bound inboxes. Share the ingestion/review/commit boundaries rather than forking them by provider.
4. **Evaluate recognition alternatives on real inputs.** Compare CPU OCR and visual methods on a held-out corpus. Add accelerated execution when available and justified. Avoid selecting a GPU model or algorithm by assertion. Recognition benchmarking can progress alongside input/review work once its data contracts exist.
5. **Add scanner integration on its own track.** Develop the outbound Windows agent and actual virtual TWAIN tests when their prerequisite contracts are stable. Windows access is a legitimate prerequisite for those tests; scanner ownership is not. Add fi-7160 physical qualification when the device arrives.
6. **Release only what has passed its gates.** Keep incomplete providers hidden or clearly unavailable. Hardware qualification gates the fi-7160 provider, not an otherwise qualified image/phone release. GPU qualification gates the accelerated profile, not an otherwise qualified CPU release.

The first product milestone is:

> Select owner/location/section → capture or upload a real phone/desktop image → retain raw evidence → identify/propose the printing → review/correct attributes and placement → explicitly commit → verify inventory, capacity, quantity and audit effects.

This milestone must work without a document scanner and without a dedicated GPU. Mocked recognition is valid for orchestration tests, but must be clearly labeled and cannot satisfy actual recognition or release acceptance.

Pure-fixture tests, actual image/engine benchmarks, real database/concurrency tests, browser tests, virtual TWAIN tests, and physical-device tests are separate evidence categories. Never use one to claim another passed.

## Begin implementation in this task

After the short repository/status reconciliation and necessary roadmap amendments, start the first foundation batch corresponding to **P1 / issue #303**, unless live inspection establishes it has already been completed.

### Purpose and scope

Implement the smallest project-appropriate TypeScript domain contracts and pure behavior needed to express a provider-neutral, location-aware capture session. Use existing storage calculations and test conventions. Add deterministic manifests/test inputs sufficient to prove the rules; do not build a full provider platform or finalize every future Prisma model.

Represent the distinctions required by the existing plan: artifact identity, physical candidate identity, observations/sides, provider/run/event identity, count certainty, allocation/overflow, recognition/review state, and target enforcement strength. Keep public contracts small and versionable. Separate raw evidence and physical occurrence identity from recognition output. Preserve a documented path for future capture sources, session intents, placement, and CPU/GPU processing without creating empty production implementations for them.

Build the minimum state/count/target behavior needed for the tests below. Reuse existing helpers when correct; document any gaps that require a later persistence or integration batch. Do not change existing inventory, import, trade, deck, League, or location-write semantics in this first batch.

### Required acceptance cases

- One explicitly identified physical item with front and back observations counts as one, not two. Pairing requires identity/evidence; dividing image count by two is not acceptable.
- One artifact with six explicitly identified detections can represent six provisional physical candidates. Count certainty and later correction remain explicit.
- Repeated observations of one identified camera episode count once. A second episode containing an identical-looking copy counts separately.
- Replaying an event with the same identity and payload does not add a candidate. Reusing its identity with a different payload yields an explicit conflict. These pure tests do not claim database durability or network exactly-once behavior.
- An unidentified card or UNKNOWN finish changes review readiness, not physical count or target consumption.
- With capacity 800 and committed quantity 537, the fill target is 263, subject to the tighter known selected-section/overall bound. Reuse actual repository semantics for unknown capacity, full/over-capacity, unconfigured sections, and direct versus descendant counts.
- A zero remaining fill target does not start automatic fill acquisition. Unknown capacity is not treated as zero or unlimited; require the supported explicit manual/untargeted policy instead.
- In an exact fixture, 300 available inputs with target 263 yield 263 acquired items and 37 unconsumed inputs. In a best-effort/logical fixture that receives all 300, 263 are allocated and 37 are retained overflow. These are different outcomes and must stay distinguishable.
- Candidate allocation follows stable acquisition/spatial order, not recognition-worker completion order.
- Missing side, conflicting boundary evidence, or a declared multifeed leaves uncertainty rather than inventing a reliable physical count.
- Stop/cancel preserves received evidence and pending/overflow items. Unsupported provider controls and invalid state transitions fail explicitly.
- Recognition success, reviewing a proposal, and reaching the target do not mutate inventory. Commit readiness remains a separate domain decision, and future commit must reauthorize/revalidate persisted state.

Use compact test cases with clear expected outcomes. No scanner, network, model download, private corpus, GPU, or real user data is needed for this batch.

### Scope exclusions for this first batch only

Do not add UI, upload routes, OCR/inference libraries, Prisma migrations, a new queue service, Docker changes, the Windows agent, real TWAIN, live video, motor control, or inventory mutations in this first foundation PR. These are staged implementation work, not permanently prohibited features. Do not claim pure reducers prove concurrent database commit safety, upload durability, recognition accuracy, or hardware feed behavior.

### Verification and stopping point

Run the repository-required checks relevant to the actual change, including the new behavioral tests. Record exact commands, outcomes, and any unavailable checks. Keep normal existing app behavior intact. Follow local-data safeguards and the repository's PR conventions.

When this first batch is implemented and verified, stop at its normal review boundary. Prepare a focused diff/PR as permitted by the established workflow; do not merge or deploy it, and do not automatically expand into all remaining phases. Update the checkpoint with the next dependency-ready task so the next Codex session can continue without redesigning the feature.

## Deliverables from this kickoff task

1. Reconciled roadmap/architecture/milestones/validation and relevant issue statuses, using the existing project system. Mark implementation authorized, identify the active batch, retain queued work, and remove outdated fi-6130Z-first or scanner-blocked sequencing where appropriate. Preserve historical reference inputs.
2. A bounded, actual foundation implementation and deterministic behavioral tests, or evidence that the batch already exists plus the next safely implemented dependency-ready batch. Documentation alone is not the requested completion.
3. A report of files/issues changed, branch/base, actual tests run and results, and which acceptance cases are proven versus still deferred.
4. Any genuine blockers, with their narrow scope. A missing scanner cannot block image/phone/domain work; a missing GPU cannot block CPU-baseline work. Do not invent hardware results or bypass genuine security, data-integrity, environment, or review requirements.
5. The next smallest implementation batch and explicit remaining gates for photo recognition, phone/live capture, durable commit, agent/TWAIN, fi-7160 hardware, and optional GPU acceleration.

**Begin the first bounded implementation now. Do not finish with another planning-only handoff. Do not merge, deploy, or claim unperformed tests.**
