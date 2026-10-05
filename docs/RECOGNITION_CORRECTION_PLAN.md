# Recognition correction feedback: evaluation and implementation plan

Planning recommendation, October 5, 2026. Reviewed source: main
`bc1b1de9946bd228f51d1b7e4e621d2c66d9ed4a`, including merged audit PR551,
printing reuse PR556, visual reuse PR592 and storage-pressure PR654.
GitHub confirms no open PR at the start of this review; recognition issues
[463](https://github.com/sefaction/MTG-Archives/issues/463) and
[307](https://github.com/sefaction/MTG-Archives/issues/307), and recovery
[310](https://github.com/sefaction/MTG-Archives/issues/310) remain open.

This report proposes application work; it does not implement it. The initial
review used source inspection and aggregate-only, repeatable-read, read-only
queries against the local test snapshot. After the user prioritized recognition
accuracy/correction feedback, a seven-case isolated printing replay tested the
reference-only hypothesis; its negative result is recorded below. No live
application, Inventory, scanner, model, production, Docker configuration or
database data was changed by this planning/probe work. Current service health is
not a source-parity or accuracy certification.

## Recommendation

Build an owner-private, batch-independent correction library, captured through
existing review saves without extra user actions. Preserve an immutable machine
evidence bundle and an append-only human decision history. Treat a correction as
a useful observation, not a verified label. Protect originals immediately with
transactional retention pins; copy them asynchronously into a separate durable
namespace. Couple this with trustworthy normal-scan sampling and an optional
inspection page. Start improving accuracy with verified distinguishing-reference
coverage and targeted error diagnosis. Defer retraining and automatic acceptance.

Collection alone does not improve recognition. Each deployed improvement must
have an explicit intervention, a reproducible baseline, an independently assessed
label set and a comparison on untouched examples.

## What exists, and what can be recovered

The current pipeline prepares immutable originals, runs CPU OCR and full-index
visual retrieval, reconciles local/provider catalog evidence, then applies a
stamp-focused printing verifier to bounded proposals. Fixed canonical title and
footer reading zones remain 0–250 and 1270–1397. OCR includes two reading
directions and bounded whole-photo fallback. Visual retrieval considers four
rotations and geometric support. The combined result offers at most twelve
printings; the native printing envelope can include up to two reference faces per
printing. Native visual and printing reuse now preserve exact unchanged inputs
within owner/version boundaries. They save work, not accuracy.

With printing enabled, `confirmStrongAcquisitionMatches` returns without
automatic confirmation. Bulk confirmation is a human action selecting proposed
printings; a saved default or bulk choice does not establish independently checked
truth. Inventory addition remains a separate explicit operation.

| Current source | Finding and implication |
| --- | --- |
| `lib/acquisition-store.ts`, `saveAcquisitionReview` | Session lock, candidate revision checks, retry recognition, validated attributes and a command containing actor, photo, before and after. Excellent capture transaction boundary. Commands do not bind the displayed machine job/bundle or alternatives. |
| `components/AcquisitionReviewControls.tsx` | Initial selection falls back to the first proposal. Dirty drafts retain their revision/choice while polling can replace suggestions and evidence. The machine suggestion at save time may differ from the one that triggered the correction. |
| `components/AcquisitionBulkReview.tsx` | Bulk preview reads each first proposal and sends ordinary accept requests. Record this interaction origin separately from individual corrections. |
| `lib/acquisition-recognition-jobs.ts` | Review evidence selects completed jobs and matching catalog/printing lineage, with pending/failure uncertainty. A later query for the latest result cannot reconstruct exactly what was previously displayed. |
| `AcquisitionCandidate.review`, `AcquisitionCommand`, `AcquisitionCommitMember` | Latest decision, before/after history and final receipt are different evidence sources. `AcquisitionCountCorrection` concerns physical counting, not recognition correction. |
| `AcquisitionProcessingJob`, native workers | Persist inputs/outputs, version keys, OCR text/scores/polygons, proposal reasons, visual distances/inliers, stamp/alignment observations, descriptors and some catalog identities. Job output is bounded to 64 KiB. |
| `lib/acquisition-review-evidence.ts` | UI projection deliberately omits worker descriptors and some scores/internals. Archive authorized server evidence, not just the browser projection. |
| `lib/acquisition-photo-retention.ts`, `lib/acquisition-photo-pressure.ts` | Post-commit seven-day original expiry, expired Trash removal and 90%-to-80% pressure reclamation remove raw and preview files. Pressure tombstones commit before unlink; retry unlinks can occur outside that transaction. Existing predicates do not protect a future correction library. |
| `lib/acquisition-files.ts`, `lib/backup.ts` | UUID raw/preview namespace under `UPLOADS_DATA_PATH/acquisition-v1`; digest checking and safe file operations exist. Default backup mappings include uploads; custom mappings override defaults and need explicit coverage verification. |

### Local historical audit

These are local snapshot diagnostics, not production counts, truth labels or a
random population sample. Test/development records are mixed with retained user
history. No original images, actors or private event IDs are published here.

| Observation | Count |
| --- | ---: |
| Photo rows / ready unpurged originals / distinct retained byte digests | 1,093 / 1,092 / 574 |
| Retained original bytes | 2,832,075,218, approximately 2.64 GiB |
| Saved latest reviews / automatic-origin latest reviews | 113 / 20 |
| Human review command events / distinct photos referenced | 102 / 94 |
| First saved selections with no previous card ID | 92 |
| Saves retaining the previous printing | 7 |
| Changes between two saved printing IDs | 2 |
| Return to pending | 1 |
| Two printing-change events with retained source and a prior completed job | 2 / 2 |

One human save followed an automatic-origin review and retained its printing.
The two ID changes prove a saved printing changed; they do not prove the previous
printing was a machine error. The 92 first selections can contain the most useful
corrections because the user may have changed a machine default before the first
save. Their before field is null, so before/after review comparison misses them.
Conversely, a first selection agreeing with the proposal can still be wrong.

Recover history conservatively in a read-only export: join commands, photo
generation/digest, candidate lineage, receipt and preceding completed jobs;
reconstruct event order by candidate revision, not just timestamps. Check actual
original existence and digest. Match job completion evidence to the event rather
than using today's latest result. The audit's simple prior-job count used creation
order and current COMPLETE status; it does not prove completion before the save,
correct display lineage or reference reproducibility.

Classify imported evidence as `HISTORICAL_LINKED`, `HISTORICAL_INFERRED` or
`HISTORICAL_METADATA_ONLY`, with explicit missing-field reasons. New captures use
`CAPTURED_AT_SAVE` and retain their verified display identity. Never invent missing
scores, versions, alternatives or scans; never silently recreate an original from
a preview. Sources already purged cannot be recovered from command or Inventory
receipts alone. An independently found backup may recover bytes only after its
digest and owner lineage are validated. Developer-used examples remain development
examples even if backfilled now. No reliable correction total is established yet.

## Feedback semantics without additional review steps

The capture unit is one owned original generation plus its machine evidence, with
multiple human decision events. Printing identity uses stable local/Scryfall IDs
and a frozen set/collector/language/face/treatment projection. Store finish and
condition as ancillary attributes; neither is an exact-printing correction by
itself. Quantity, placement, count reconciliation, defaults and exclusion are
separate events. A different language-specific printing ID is an identity change;
editing a language field alone is not proof of an image-recognition mistake.

Capture these two separate comparisons:

1. **Recognition feedback:** saved printing versus the machine first suggestion
   the user was shown, including whether the chosen printing was among alternatives.
2. **Label history:** new saved printing versus the previous human/automatic saved
   selection, including source and unchanged attributes.

This distinguishes `FIRST_CHOICE_AGREEMENT`, `OFFERED_ALTERNATIVE_SELECTED`,
`SEARCHED_PRINTING_SELECTED`, `NO_SUGGESTION_RESOLVED`, `LABEL_REVISED`,
`METADATA_ONLY`, `RETURNED_TO_PENDING` and `EQUIVALENT_ID_CHANGE`. These are evidence
categories, not automatic correctness judgments. A search-assisted alternate is
not inherently more trustworthy than a proposed alternate.

Keep cheap save classifications for denominator/lineage tracking. Create or extend
a retained example for an actual proposal disagreement, no-suggestion resolution,
printing-label revision, uncertain historical/display attribution worth inspecting,
or prospectively selected normal control. Metadata-only saves need no new original
copy; they append ancillary history only when an example already exists. This avoids
retaining every ordinary accepted scan indefinitely. Collection rules and any
sampling decision are versioned so missing examples cannot be mistaken for successes.

On the review read path, return an opaque, server-authenticated evidence token
binding owner, original generation/digest, candidate revision, actual source job
IDs, ordered proposal projection and interpretation version. Hidden client
bookkeeping retains the initial machine bundle, the displayed bundle when printing
editing begins, and any changed bundle actually displayed before save. Bind the
same tokens to restored drafts and bulk previews. At save, resolve immutable job
outputs server-side and snapshot them; do not trust client-supplied scores,
candidates or labels as machine evidence. Keep the chosen search-result projection
too. No additional button, confirmation or survey is required.

Preserve the earliest machine proposal for that original generation separately
from the first bundle shown and the edit/save bundles. If it was never displayed,
record that fact. Intermediate generations can be represented by immutable source
identities unless actually displayed or needed for a correction; the earliest
proposal must not be replaced by a later “original” suggestion.

Candidate save authorization remains independent of evidence-token availability.
A valid review must not fail solely because an old client lacks a token: collect
server evidence with `DISPLAY_IDENTITY_UNKNOWN`, without falsely attributing a
correction to a suggestion the user saw. Instrument these gaps so new clients can
reach complete capture. Token ownership/tampering failures must never authorize
access to another owner's evidence. Preserve both original and later machine
suggestions; refreshing recognition must not rewrite the correction's baseline.

Every successful save has an idempotent event key based on owner/candidate/photo
generation and resulting review revision. Lost-ack retries produce one event.
Repeated A→B→C decisions preserve all events, with one current label and superseded
labels. A→B→A is a reversal, not two independent mistakes. Returning to pending
withdraws the current usable label; it retains the scan and history. Conflicting
labels or actors enter unresolved status. Retakes have a new byte identity but
share the known physical-copy group. Do not infer such a group from a name alone.

Collected labels start **unverified**. Optional library inspection can verify,
correct, mark ambiguous, or withdraw a label, with actor/time/reason provenance.
Verification requires visible distinguishing evidence or explicit physical-card
inspection provenance. Stamp unreadability stays unknown. For visibly identical
product distributions, retain an acceptable equivalence set and avoid pretending
the photo identifies a booster product. A reviewed ID change within such a set
is not a hard training negative. Inventory commit supports lineage, not truth.

## Batch-independent preservation

### Logical records and storage

Introduce independent records for `CorrectionExample`, `CorrectionEvent`,
`EvidenceBundle`, `CorrectionBlob`, `RetentionPin`, `CaptureOutbox`,
`LabelAssessment`, `EvaluationMembership` and `AnalysisRun` (names illustrative).
Use independent primary keys and owner scope. Original session/candidate/job IDs
are provenance fields, not cascading lifetime dependencies. Deleting a batch must
not delete examples, labels, bundles or library memberships.

Place raw blobs under a dedicated private namespace, for example
`UPLOADS_DATA_PATH/correction-library-v1/<owner>/<digest>`, outside UUID batch-file
cleanup. Reuse safe-path, no-symlink, immutable-write and digest checks. Prefer an
explicit copied object over a hard link to the batch file: it gives portable
backup/accounting and clearer lifetimes. During copy, temporary overlap costs one
additional original; release the source pin only after durable verified completion.

Deduplicate exact bytes **within an owner**, using a unique owner/digest key and
reference memberships, while preserving separate physical-copy and correction
events. Do not merge labels just because hashes match. Evidence deduplication keys
also include ordered native candidate envelope, input kind, descriptors, parser/
policy/catalog/reference generation and output digest. Recaptures or perceptually
similar images may be grouped for analysis/splitting, never substituted for an
original. Avoid cross-owner blob/reuse lookup and existence/timing disclosure.
Private originals and labels do not become shared model/reference data by default.
Existing explicit admin access requires authorization and audit logging.

### Save-versus-cleanup race and recovery protocol

1. In the **same existing review transaction**, hold the session lock, validate the
   live original generation and review revision, save the review, create the
   immutable event/evidence snapshot, a source retention pin and a durable outbox
   item. Rollback leaves neither an accepted save nor a partial capture event.
   Expensive image copy/inference does not run inside this transaction.
2. All three cleanup paths must respect these pins: normal committed expiry,
   Trash expiry and pressure cleanup, including retry deletion of tombstoned
   batches. Check under the shared session lock immediately before tombstone/
   unlink, not just during candidate selection. Keep a batch with pending source
   pins ineligible for destructive cleanup until preservation or explicit removal.
   Pressure's current unlocked unlink loop needs the shared guard; merely adding
   an exclusion to its initial query is insufficient. Follow the existing scanner
   root/run/session lock order and consistently ordered owner/blob locks to avoid
   introducing deadlocks.
3. If review/pin commits first, cleanup must wait/skip. If cleanup wins and commits
   its deletion fence first, a new review cannot create a complete capture against
   those deleted bytes. Historical salvage after a deletion marker is incomplete
   unless independently recoverable bytes already exist. A library worker must
   remain able to access its pinned source even if batch visibility later changes.
4. A dedicated leased outbox worker copies to a same-filesystem temporary object,
   verifies size/digest, flushes bytes and atomically publishes without overwriting
   an existing object. Flush the directory where supported. Only then transactionally
   attach the blob, mark preservation complete and release the source pin. Worker
   leases fence stale completion; neither batch cancellation nor recognition job
   retirement may cancel this independent preservation job.
5. Crash before copying: pin/outbox survive. Crash after object publication but
   before database attachment: retry validates and attaches the existing object.
   Crash after attachment: retry is a no-op. Corruption, missing source or permission
   errors stay visible, keep the pin and require retry/restoration or explicit
   owner-authorized evidence removal. Never mark a failed copy preserved.
6. Orphan GC uses a two-phase deletion claim, checks live memberships, reservations,
   pins and leases under the blob lock, then deletes only unreferenced library
   objects after a grace period. New attachment cannot race a claimed deletion.
   Temporary-file cleanup cannot remove a leased active copy.

These are implementation requirements, not claims about protections in today's
cleanup. They cover concurrency within the application; operator deletion of
storage or loss of the physical disk still requires backup recovery.

### Evidence worth retaining

**Essential:** byte-exact original/digest/size/type; input kind and capture metadata;
owner and physical-generation provenance; machine first suggestion, all displayed
ordered alternatives and bounded upstream retrieval orders; chosen printing and
frozen card projections; before/after decisions; raw saved OCR lines/scores/polygons,
orientation/geometry/reading zones; visual distances/inliers; actual printing
candidate envelope, alignment/stamp observations and uncertainty; source job IDs,
available descriptors/policies/catalog hashes; timing with reuse/queue scope;
explicit missing-evidence flags and label/verification history.

Use an allowlisted evidence schema: exclude authentication/session tokens, pairing
codes, credentials and unrelated scanner/browser context. Keep private originals
and detailed evidence out of public PRs, issues and Foundry notes; exports require
owner authorization and appropriate redaction.

Keep versioned manifests and relevant catalog rows, not just version strings.
Archive or pin the actual reference faces and annotation manifest used by a replay,
and preserve the content-addressed model/runtime generation once per release.
The corrected printing's missing reference is a separately tracked gap, not
evidence that it was evaluated originally. A catalog digest alone does not recreate
the full old candidate universe: exact end-to-end replay additionally requires a
versioned catalog projection and visual index/model artifact. Preserve these once
per selected experiment/release when feasible; otherwise label replay as partial
and never present current-reference replay as original-run reproduction.

**Optional or regenerable:** small thumbnails and aligned inspection crops;
cached embeddings/features keyed by complete input/version identity. Retain only
when measured replay cost justifies them. Avoid per-example copies of full models,
entire indexes, every unrelated job retry, full browser traces, unbounded logs or
every decoded intermediate. Current bounded stage outputs usually suffice for
triage; targeted expanded diagnostics can be captured by an offline replay with
their own provenance. Don't fabricate scores the production stage never saved.

### Capacity, removal and backup

Use a separate durable-library allowance, with no age-based or pressure-based
automatic eviction. Show original blobs, evidence/reference artifacts, thumbnails,
temporary copies, reservations and pinned batch bytes separately. Owner accounting
counts a unique retained blob once; host disk accounting includes real copy overlap,
all owners and a global safety reserve. Correction allowance reservations serialize
concurrent writes and prevent oversubscription. Existing scan-original quotas do
not currently account for all these additional bytes.

At an illustrative 6,000,000 bytes per scanner front, 1,000 unique corrections
cost about 5.59 GiB raw; 10,000 cost 55.9 GiB. At 150,000 cards, 1% unique corrections
would cost about 8.38 GiB; 5% about 41.9 GiB, before controls/backups/references.
The local mixed-source mean is approximately 2.59 MB and is not a scanner-size
forecast. Each accepted image can be up to 10 MiB. Four complete 64 KiB stage
outputs add at most 256 KiB per bundle before extra catalog/display metadata;
multiple evidence versions grow independently of raw-image deduplication.

If the library allowance or disk reserve is exhausted, save the review and small
transactional event, retain the source pin, mark capture `WAITING_FOR_SPACE`, and
surface a persistent account/admin warning with pending bytes and oldest age.
Retry after capacity changes. Do not silently drop examples, previews masquerading
as originals, or their evidence. Pinned batches may prevent reclamation and
eventually block new upload admission under the existing scan allowance. This is
the honest finite-storage tradeoff: unlimited retention, finite disk and unlimited
continued intake cannot all be guaranteed. Prefer protecting evidence and pausing
intake over silent loss; a product choice is required before implementing limits.
The review transaction itself still needs working database capacity, as today.

Offer separate controls for **withdraw label** (retain evidence), **exclude from
analysis** and **delete example/evidence** (explicit owner action with a byte-impact
preview). Deleting a batch does not delete library evidence. Full deletion removes
memberships, labels, dependent derived exports/caches and unshared bytes through
retryable GC; a minimal non-sensitive tombstone prevents backfill recreating it.
Deletion of a pending capture releases its pin only after its deletion intent is
durable. Removing one duplicate membership does not delete bytes needed by another.
Show how backups retain deleted bytes until their documented backup expiry; restore
must reapply deletion tombstones before reopening analysis.

Include library bytes/metadata/pins/outbox in consistent backup and isolated restore
tests. Keeping the namespace under uploads helps default archive coverage, but
custom `BACKUP_APPDATA_PATHS` must be checked explicitly. Validate bundle/blob
references, retry interrupted copies, retire restored worker leases and prove normal
batch cleanup cannot reclaim restored examples. PR652's unfinished restore fencing
work is separate; do not claim existing recovery covers new library semantics.

## How corrections can improve accuracy

Automatically cluster diagnoses as provisional suggestions; verification controls
labels and reference promotion. Track recurring failures by unique digest,
physical-copy group, printing family and exposure denominator, not edit-event count.

| Intervention / mistake | Use of correction data and automation | Verification, cost and risk | Proof required |
| --- | --- | --- | --- |
| **Reference coverage and integrity:** missing/unverified original or stamped counterpart | Compare verified target with references actually present and evaluated; generate missing-face/annotation worklists. Automatically fetch eligible public references into staging and check hashes/provenance. | Human inspection verifies PRESENT/ABSENT/UNKNOWN and relevant face/treatment. Low compute, reference disk/network cost. Do not convert detector failure into an ABSENT reference or promote private scans as public references. | Frozen baseline versus reference-only replay; independent stamped/unstamped, blur/clipping and unavailable-reference controls. Exact first/offered accuracy and wrong explicit stamp conclusions. |
| **OCR and parsing:** readable title/number lost, fragmented footer, wrong orientation | Pair saved text/polygons with verified visible target; identify extraction versus parser versus catalog failure. Automatically replay parser changes on saved OCR; run targeted original OCR only for localization/extraction changes. | Verify transcription and readable region; low parser cost, seconds-to-tens-of-seconds native work per scan. Preserve fixed-zone baseline; no guessed characters or target IDs fed into runtime OCR. | Held-out transcription/identifier recovery plus exact/offered accuracy; poor-front negative controls; count extra OCR calls and tail latency. |
| **Candidate recall/family completeness:** target omitted or truncated | Diagnose target in catalog/index, raw retrieval versus combined top twelve, retained printed aliases/language/treatment families. Test observed-evidence candidate unions and bounded broad fallback. | Verify target/family projection and missing-reference status. Medium compute/catalog I/O. Target labels are evaluation outcomes, never retrieval inputs. Narrowing can exclude rare printings. | Recall at offered limit, first accuracy, per-family regressions and operation/latency counts on unseen families as well as same-family new copies. |
| **Ranking:** correct target offered below a similar/shared-art printing | Use verified offered alternatives as diagnostic hard negatives. Start with interpretable title/identifier/image agreement and conflict rules; consider a small calibrated reranker only after sufficient groups exist. | Verify visible differences and label consistency. Low rule replay; moderate feature/native cost. Memorization, correction-only bias and equivalence mistakes are major risks. | Paired exact-first wins/losses on untouched groups; unchanged recall, calibration and normal-scan regressions; no tuned-validation reuse. |
| **Distinguishing details:** original/List stamp, set symbol, footer or frame ambiguity | Align actual proposed reference faces and compare only the unresolved difference. Corrections identify missing checks and useful crop annotations, not a new truth source. | Verify positive, absent and unreadable evidence. Medium registration/native compute and annotation cost. Crop clipping/blur and physically identical products require abstention/equivalence. | Independent positives, hard negatives and poor reads for each check; exact/equivalence accuracy, false detail claims and abstention. The existing verifier is stamp-focused, not a general detail classifier. |
| **Quality/negative front gate:** backs, sleeves, unreadable fronts getting confident proposals | Use verified negative/unobservable examples and representative difficult valid fronts to test a cheap early gate and explicit unresolved state. | Human labels image observability; low inference cost. False rejection of a valid front is a regression. | Front recall, negative rejection, exact printing among surviving fronts and processing saved; unresolved outcomes stay in all-input reporting. |
| **Model training:** persistent OCR/stamp/embedding failures after cheaper fixes | Build versioned opt-in training exports from verified, non-conflicting development groups; include normal positives and realistic negatives. A task-specific OCR/detail model or reranker may be more appropriate than retraining the whole visual model. | High annotation/compute/artifact cost; private-data authorization, overfitting, catalog drift and catastrophic regression. Automatic preparation is possible; training scope, labels and promotion require verification. | Frozen independent validation and later shadow qualification with reproducible version artifacts, paired regressions/resource checks and rollback. No live or continuous self-training. |

The earlier [audit](RECOGNITION_PIPELINE_AUDIT.md) is a starting point, not a promise:
40 reused development images improved from 34 to 38 first-correct with partial
scoping, but all three routes were 36/41 first and 41/41 offered on locked validation.
Scoping reduced global searches 41→4 and printing registrations 501→125.
The five first-choice failures were three correlated original/List groups, with
`NO_VERIFIED_UNSTAMPED_REFERENCE` on a sharp aligned Samut's Sprint. Broader retrieval
does not supply that missing verification. The old validation has now informed this
proposal; it becomes a disclosed regression set for subsequent development, not
untouched proof for a reference fix designed from its errors.

## Evaluation that can support a decision

### Two datasets with different jobs

Maintain a correction-enriched **diagnostic set** to explain/fix failures and a
representative **normal-scan sample** to estimate performance/regressions. Sample
normal scans prospectively before correctness or review outcome is known, using a
recorded seed/probability and strata such as owner, phone/scanner, input quality,
printing family, language and treatment. Include no-candidate, negative, pending
and failed-processing inputs; do not sample only completed nonempty proposals.
Use existing saved scans without new operator actions, but pin selected control
originals too. No extra scanner feeding is required by this plan.

Normal saved-choice agreement is still unverified. Optional independent assessment
provides truth labels without changing ordinary review. Report a production-weighted
normal estimate separately from correction-set recovery and balanced stress tests.
Four uneven owners require both overall weighted rates and per-owner/device strata;
do not let one large owner hide another's failures. A correction-only sample cannot
estimate overall accuracy or correction prevalence.

### Splits and label governance

Before feature development, freeze manifests with original hashes, label revisions,
known physical-copy identity, printing/equivalence family, perceptual/recapture
links, prior development use and split membership. Build conservative connected
groups for exact duplicates, rotations/encodings, known same-copy recaptures and
family aliases. Keep a group wholly within one partition; audit nearest visual
duplicates across splits. Unknown physical identity is an explicit limitation.
Do not equate two separately verified physical copies solely by printing ID.

Use development/training, development-validation for selecting rules/thresholds,
and an untouched final validation. For generalization to unseen printings, withhold
whole distinguishing/shared-art families, including original/List counterparts.
Separately evaluate new physical copies of known families as an operational cohort;
do not call that unseen-family accuracy. Established pretrained public catalog
references are permitted and pinned, but any newly learned correction-specific
reference/annotation must be documented as an intervention. It cannot secretly
use final validation truth to select runtime candidates or tune a rule.

Have assessors read originals/complete distinguishing regions before seeing the
alternative system's output. Retain unresolved/equivalence labels and adjudication
provenance; don't force every scan to one ID. Freeze truth first. Evaluation-created
label changes version the manifest and invalidate stale aggregates. Withdrawn or
conflicting labels cannot enter training or strict accuracy denominators. Expensive
tests can run on verified examples without making their label intrinsically true.

### Measurements and release gates

For each baseline/proposed pair use identical originals, frozen catalog/reference/
model inputs, resource limits and declared candidate limits. Lock the proposal
before a single final-validation comparison. Rotate warm run order; measure cold
start and restart separately. Full accuracy comparison must include complete pairs;
timeouts/failures remain failures or abstentions with their denominator disclosed.
An evidence-only replay can isolate parsing/ranking but cannot substantiate full
pipeline latency. Also measure actual queue/provider/upload-to-review time later.

| Measure | Definition/reporting |
| --- | --- |
| Exact-printing first accuracy | Correct first ID / independently resolved identifiable fronts, plus acceptable-equivalence accuracy separately. Report unresolved, equivalent-only and failed inputs explicitly. |
| Correct printing offered | Target ID/equivalence member present within the actual displayed proposal limit; failures/no proposals count as not offered for resolved fronts. Also report catalog/reference coverage. |
| Correction rate | Distinct review episodes changing a displayed suggestion / eligible reviewed episodes with known display identity. Separate initial disagreements, later label revisions, bulk agreement, metadata-only edits and measured proposal-error proxy. Not an independent truth measure. |
| Abstention/coverage | No decision, unresolved proposal and manual-review requirement, separately. Human choice of the top suggestion is not automatic coverage. |
| Wrong automatic acceptances | If an offline gate is studied, wrong / all automatic decisions and wrong / all eligible inputs, together with coverage. With zero decisions precision is undefined. Existing hybrid has zero automatic decisions. |
| Cost and latency | Median/p95/max native and end-to-end time, queue wait, CPU-seconds, peak memory, OCR calls, embeddings, broad searches, registrations, provider calls/cache hits, reuse hits and timeout/restart counts. Original inference timing and cache execution timing stay separate. |

Publish sample sizes in images, unique hashes, physical-copy groups and families;
per-stratum outcomes; paired wins/losses; cluster-level uncertainty and all
regressions. Image Wilson intervals can be descriptive, but use grouped bootstrap
or group-level paired analysis for correlated captures. Do not count retries as
new accuracy samples. Small stress cohorts demonstrate mechanisms, not population
benefit. Preregister acceptable accuracy/recall/latency regression margins after
the normal baseline is measured, before selecting a fix.

A better first suggestion can ship review-only after regression and resource
qualification. Automatic acceptance requires a separate safety target and much
larger untouched accepted-decision cohort: even zero errors in 300 independent
acceptances gives a one-sided 95% upper error bound near 1%; 3,000 gives about 0.1%
(`1 - 0.05^(1/n)`). Correlation and biased selection weaken those claims. Do not
enable automatic decisions from a few corrected examples or high top-rank accuracy.

## Efficient background work and optional inspection

Capture cheap metadata, snapshot references and pins on save; prioritize preservation
I/O over discretionary analysis. Run inference/replay in a separate bounded queue
and process/container, initially one job at a time with explicit CPU/RAM/disk
budgets. Yield admission while new-scan work is pending, pause under pressure,
and cap long jobs so a warm offline model cannot monopolize live worker memory.
Use fair owner scheduling and resumable leases. No analysis job may publish live
recognition, rewrite reviews, add Inventory or start physical acquisition.

Analysis identity includes original/bundle digest, verified-label revision,
analyzer version and relevant pipeline/catalog/reference descriptor. New capture
or changed relevant evidence triggers triage; a reference update replays affected
families; a parser update first replays saved text; a model change needs original
inference. A label edit generally rescoring results needs no OCR rerun. Cache exact
unchanged analysis, collapse redundant queued work, invalidate by dependency and
retain superseded reports. Repeated review polling, page visits, batch refreshes
and unrelated catalog changes must not replay every example. Offer explicit Replay
for an experiment, with a cost estimate and versioned result. Start idle/on-demand;
no recurring automation or fixed overnight window is configured by this report.

Propose one optional **Recognition feedback** page linked from Scan cards:

- **Examples:** original versus original suggestion and corrected printing, offered
  alternatives, source date, confidence/uncertainty, capture completeness, owner
  storage and filters. Details show decision timeline and available evidence.
- **Recurring problems:** unique affected examples/families, missing references,
  OCR/parsing, missing candidates, ranking/detail/quality problems and unknown
  diagnosis. Show prevalence only when a sampled exposure denominator exists.
- **Unresolved labels:** pending/reversed/conflicting/equivalent cases, with optional
  Verify, Correct label, Mark ambiguous and Withdraw. No changes to Inventory.
- **Experiments:** baseline/proposal sample sizes, split/history disclosure, paired
  metrics, regressions, costs, uncertainty and deployment version/rollback record.

Show separate states: preservation `PENDING/PRESERVED/BLOCKED/FAILED/DELETED`;
label `UNVERIFIED/VERIFIED/AMBIGUOUS/WITHDRAWN`; experiment
`NOT_TESTED/TESTED_IN_DEVELOPMENT/VALIDATED/REJECTED`; release `NOT_DEPLOYED/DEPLOYED`.
“Collected”, “verified”, “tested” and “deployed” describe different facts, not a
single progress badge automatically advanced by job completion. Use paginated
desktop rows and phone cards; load private thumbnails lazily and avoid automatic
full-resolution decode across thousands of examples.

## Phased delivery and acceptance

Each future coherent implementation batch gets its own branch/PR, cumulative local
Docker review and current checks; individual merge approval and production rollout
authorization remain separate. The present batch is documentation only.

| Phase | Deliverable / exit criteria |
| --- | --- |
| **0 — This evaluation** | Source/cleanup/history findings, semantics, tradeoffs and experiment protocol. Historical capture completeness is explicitly limited. Review the remaining decisions below before application implementation. |
| **1 — Reliable capture and retention** | Independent records/namespace, authenticated display bundles, append-only review events, pins/outbox, every cleanup guard, owner accounting, recovery/removal and backup integration. Existing individual/bulk/save-next/retry workflows take no additional actions. No ranking changes. |
| **2 — Backfill and inspection** | Conservative idempotent backfill with incomplete-evidence flags; simple optional page, label provenance and normal-scan sampling. Development-used history cannot enter untouched validation. No promise that backfill recovers every first-save correction. |
| **3 — First offline accuracy experiment** | Verified reference-gap experiment below, with frozen diagnostic/normal controls, new independent validation and bounded resources. Deliver a report whether positive or negative; no automatic promotion. |
| **4 — Targeted review-only improvements** | Implement the measured failing stage: reference coverage first if supported, then OCR/parser, recall/family, ranking or detail checks based on evidence. Version artifacts, shadow/offline comparisons, normal-scan regression and local UI/resource gates before rollout. |
| **5 — Conditional training or automation** | Only if simpler interventions leave sufficient verified failure groups and resource/accuracy evidence justifies cost. Separate data-sharing/training and automatic-acceptance decisions, larger untouched cohorts and rollback. This phase may never be needed. |

Minimum phase 1–2 tests must include:

1. First-save alternative/search corrections captured even with null before review;
   same-printing condition/finish/default/count/storage edits not counted as printing
   errors; individual/bulk/automatic origin distinct; equivalent ID changes separate.
2. Polling reorders proposals during editing, restored browser draft and old-client
   save retain correct display attribution or explicitly mark it unknown. Retry
   after a lost save acknowledgement creates one event; concurrent stale save
   creates none. A→B→C, A→B→A and pending withdrawal preserve correct label lineage.
3. Real PostgreSQL/file races against normal expiry, Trash expiry and pressure
   tombstone/retry unlinks. Prove save-first preservation, cleanup-first rejection
   and no missing scan behind `PRESERVED`, including process kill at every boundary.
4. Failed copy, ENOSPC/quota, corruption, missing file, permission failure, expired
   lease and published-file/database-attach crash recover visibly and idempotently.
   A pin is never released by age or retry exhaustion. No live scanning/UI latency
   regression from preservation or offline analysis under four uneven owners.
5. Within-owner deduplication without label collapse; cross-owner read/export/token/
   timing isolation; membership removal versus final-byte deletion, GC/attachment
   races and backfill-after-delete tombstones. Evidence remains after batch deletion.
6. Accounting across concurrent capture/copy/retry/deletion, pending pinned bytes,
   temporary overlap and backup storage. No silent evidence loss on full allowance.
   Default and custom backup mappings, consistent snapshot and isolated interrupted
   restore preserve originals, event order, tombstones and retry authority.
7. Analysis idempotency and invalidation: unchanged visits trigger no inference;
   label-only updates rescore; reference changes replay only affected dependencies;
   no live job publication/Inventory mutation/scanner command is possible.
8. Paginated desktop/phone inspection, unresolved labels and four distinct lifecycle
   states. Split-leakage tests reject duplicate/recapture/family crossings and any
   mislabeled historical “held-out” example. Evaluation reports complete pairs,
   failures, equivalence denominators, group counts and regressions.

## Smallest useful first experiment

### October 5 historical mechanism probe: reference annotations alone were insufficient

Following the user's recognition-accuracy/correction-feedback priority, an isolated
printing-only probe compared current policy with a six-reference annotation addition.
Complete public original/List faces for Samut's Sprint, Bloom Hulk and Courage in
Crisis were inspected independently of scan predictions; their visible lower-left
stamp regions were bound to verified file hashes. All six had been UNKNOWN in the
baseline annotation set. Proposed originals were ABSENT and List faces PRESENT.
The annotations remained staged privately; none was loaded into the application.

The seven-case probe reused one already inspected historical scan from each of
those three failure groups and four controls (two stamped, two unmarked). Each
retained original digest and the ordered reference/candidate envelope matched its
frozen prior baseline. Labels entered scoring only. Both variants ran the same
current registration/stamp source, fixed reference generation and image bytes,
with one thread, two CPUs, 2 GiB, no network/database access and read-only inputs.
Registration fixes its internal RANSAC seed at 20260928 for both variants (the
outer probe's seed of zero is superseded by registration). Native inputs,
full observations, hashes and progress/terminal records remain private.

| Diagnostic family | Baseline | Verified-reference variant | Remaining observation |
| --- | --- | --- | --- |
| Samut's Sprint WAR142 | Unreadable; no verified unmarked reference | Unreadable; local evidence inconclusive | Original-reference correlation 0.9855, mean residual 6.03, p95 28.28; both query template response 0.4559 and verified unmarked reference response 0.4598 fail the unchanged absence limit below 0.45. |
| Bloom Hulk WAR154 | Unreadable; no verified unmarked reference | Unreadable; local evidence inconclusive | Correlation 0.9755, mean residual 9.66, p95 39.46; query response 0.4574 fails the 0.45 limit and upper-tail residual fails the 35 limit. Reference response 0.4494 passes. |
| Courage in Crisis WAR158 | Unreadable; no verified unmarked reference | Unreadable; local evidence inconclusive | Correlation 0.9827, mean residual 7.85, p95 42.13; verified unmarked reference response 0.4571 fails the 0.45 limit and upper-tail residual fails the 35 limit. Query response 0.4423 passes. |

All four control observations, reasons and candidate relations were unchanged;
the two stamped controls remained PRESENT and the two unmarked controls remained
UNREADABLE. No automatic acceptance occurred in either variant. All seven paired
cases completed in 109.88 seconds; the named isolated container exited successfully
and was removed. Source collection/photo/review/receipt projections are unchanged.

A follow-up reran the three original-reference observations and exactly reproduced
the saved inference evidence before explaining each absence guard. An initial
diagnostic assertion failed because its copied residual calculation differed from
native inference; it was corrected to the native formula, then all three equality
assertions passed. The diagnostic did not change inference or thresholds. Two
verified unmarked references have an intrinsic template response above the absence
guard, so improving scan residuals alone cannot make those references establish
absence under current policy. Printed-footer confusion is a hypothesis, not a
confirmed cause or justification for relaxing that guard.

Six public original/List images were also passed directly through unchanged native
inference as separate clean-reference controls. All were UNREADABLE with
STAMP_CLIPPED_OR_TOO_SMALL: the public images are 488 pixels wide, below the native
500-pixel source-card-width requirement. This completed negative check cannot
separate scan noise from policy behavior or qualify physical scan accuracy. No
upsampling was used to claim sufficient observed detail. These controls and the
diagnostic containers are terminal and removed; their private evidence is retained.

This rejects **reference annotations alone are sufficient for these three known
groups**. It does not establish that annotations lack value, that an unreadable
scan is stamped, or that loosening a threshold would be safe. No first-suggestion
accuracy gain is claimed. This is historical development diagnosis, not untouched
validation or a population accuracy estimate; the old validation examples have
now been used to design this intervention and remain unsuitable as untouched
evidence for it.

Next: inspect calibrated local stamp-region registration, nuisance lighting and
printed-footer confusions, retain positive/obscured/clipped controls, and establish
new independent examples before proposing a policy change. Do not promote the
annotation addition or relax the absence/presence guards based on this probe.
Reliable new feedback preservation still awaits the requested storage/privacy and
normal-control-sampling choices. The general protocol below remains useful for
new families and a newly frozen cohort, with this negative result included.

Use a **reference-only, offline original/List comparison**, without training,
threshold relaxation, routing changes or live recognition writes.

1. Recover and inspect a small development set of correction-related original/List
   families, including known `NO_VERIFIED_UNSTAMPED_REFERENCE` diagnoses. The two
   local saved-ID edits are candidates for inspection, not a required sample size
   or proof that this family is their cause. Reused audit failures may explain the
   mechanism but cannot certify its improvement.
   Start with one known failing development family and one stamped/unmarked control
   pair; that is the smallest mechanism probe. Expand only if it establishes that
   the missing verified reference changes the actual evidence as hypothesized.
2. Verify the public original and stamped reference faces independently and bind
   annotations to their hashes. Identify missing rather than merely UNKNOWN
   references. Replay identical actual baseline candidate envelopes with only the
   staged reference/annotation change. This isolates distinguishing evidence.
3. Freeze a new evaluation cohort before inspecting proposed results: aim initially
   for 20–30 new independently labelled affected-family fronts with both stamped
   and unmarked cases, plus 50–100 sampled normal/control fronts, including poor
   crops and other printing families. These are feasibility targets, not statistically
   sufficient certification; availability may require a smaller explicitly bounded
   pilot. New examples can come from ordinary saved scans; no physical feed is
   authorized here. Known same-copy recaptures stay grouped and disclosed.
4. Report verified-reference coverage, explicit correct/incorrect/unknown stamp
   evidence, exact first/offered outcomes, paired wins/losses, groups, cost and
   normal-control regressions. Keep all current safety gates and review-only policy.
   Stop if correct references still leave evidence unreadable: document that result
   and investigate visibility/detail reading rather than declaring collection a win.

Success for the small pilot is demonstrated correct mechanism recovery without
incorrect explicit evidence or candidate loss in its bounded controls, plus a
measurable result on newly frozen groups. That warrants a larger qualification,
not automatic deployment or a population accuracy promise. Before doing the pilot,
phase 1 preservation protects new feedback from ordinary cleanup; historical-only
work can be inspected privately without pretending it substitutes for new capture.

## Decisions needed before implementation

Recommended defaults are proposals; none blocks completion of this planning review.

- **Storage:** choose a separate per-owner library allowance and backup capacity.
  Recommend no automatic expiry, visible pending capture, source pinning and intake
  backpressure when finite storage cannot hold more. Exact GiB values require a
  current host disk/backup budget; don't reuse the 64/4 GiB scan allowances blindly.
- **Scope/privacy:** recommend private examples and within-owner deduplication.
  Cross-owner research/training exports or transfer to another service require a
  separate explicit choice; public reference improvements can use verified public
  assets without sharing private originals.
- **Normal controls and verification:** recommend a bounded prospective sample
  (for example 1% selected before outcome, with a configured cohort cap) and optional
  independent assessment in the library. Confirm the storage budget and who may
  verify labels. Captured user selections alone remain unverified.
- **Removal:** recommend distinct withdrawal and full evidence deletion, durable
  deletion tombstones and documented backup expiry. Confirm how long deleted bytes
  may remain in backup archives.
- **Promotion goals:** start with review-only first-suggestion improvements. Agree
  acceptable recall/latency regression margins after a normal baseline, and choose
  a separate error/coverage target if automation is later desired.

Historical gaps, unknown physical-copy identity and missing version artifacts are
material limits. The system can make corrections durable and useful; accuracy gains
must still be earned by verified interventions and independent evaluation.
