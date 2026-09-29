# Acquisition worker turns across collection owners

Workers already rotate batches within a stage. That alone gives an owner with
many batches more turns than an owner with one batch. A local historical refresh
showed nine OCR batches under one owner competing with a new owner's batch; all
pending observations were refreshes of earlier completed work.

Claims now choose the least recently served eligible owner at the stage, then
rotate that owner's batches using existing durable run turns. Owner turns are
derived from the latest run turn; no schema, priority flag or extra identity is
introduced. Bounded selection also shares equally eligible owners before taking
their second heads. A single owner's batch order and within-batch availability/
FIFO remain unchanged. The 32-candidate window, one/two-job claim limit, leases,
retries, role/phase/receipt/revision fences and explicit Inventory remain intact.

This is fairness by claim turns, not equal CPU seconds. Concurrent workers may
briefly claim the same owner. Existing background work remains queued and gets
turns; the worker does not discard it or change recognition evidence/thresholds.

The disposable database verifier tests four owners with 40 batches versus one
each, repeated rounds, persistence across client replacement, independent stages,
continued per-owner batch rotation, bounded two-job selection and zero Inventory.
Run `npm run verify:acquisition -- --core` for it and existing concurrency/recovery
checks. The complete standalone disposable database/core gate passed in 196.6
seconds with owned cleanup. The cumulative acquisition/import gate passed in
98.8 seconds. One earlier intermittent empty initial catalog claim is retained
and tracked in #498; the passing rerun does not establish its cause or resolution.

## Loaded local qualification

The original seven-input, 600-second printing completion and review case passed
with ordinary queues after loading this change in the cumulative local app. Total
runner time was 266.8 seconds, including uploads and review assertions. All seven
names were first/offered, required review and preserved raw native evidence. The
case also verified original/reference image display at 1366/390/320 pixels,
Simple/Advanced evidence separation, correction across mode changes and reload,
location/section preservation, zero Inventory and owned fixture cleanup. The
earlier 1/7 and 4/7 failed gates remain retained. Existing other-owner work
continued: a snapshot about two minutes into the run showed six OCR, six visual
and nine printing completions since this run began for the historical owner.

These are reused development images with two dependent rotations, not independent
exact-printing accuracy or 100/300-card throughput. Background load differs from
the earlier failures, so the elapsed improvement is not a controlled causal
comparison. Four-owner turn fairness is separately tested with synthetic durable
jobs; this run is not simultaneous four-user native throughput.

Thirteen nominal 20-second Docker samples showed maximum memory of 1270.8 MiB
for OCR (2 GiB cap), 1197.1 MiB for visual (3 GiB), and 1020.0 MiB for printing
(1 GiB). Printing is close to its cap and remains a larger-batch risk. The three
workers were running afterward with no reported OOM. All thirteen anonymous
login samples returned 200 within 99 ms; that is not authenticated task latency
or an exhaustive memory/CPU peak measurement. Exact sanitized evidence, source,
native identities and retained failure limits are in
`tools/acquisition-eval/owner-batch-results.json`.

This PR is independently based on main; unapproved recognition/UI/admission PRs
are used only for cumulative local testing, not introduced as dependencies.
Local source digest `052e72606b3bec3c5e37d39706a3524b96352137c97ef37417130c80fc1ebf0b`
was verified in the loaded web image and the worker claim/handoff helpers matched
both rebuilt native images. Existing OCR, visual and printing descriptors remained
unchanged. Production and scanner hardware are unchanged. Individual approval is
required; recognition #463 remains incomplete and hybrid auto-confirmation off.
