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
checks. Local real-worker completion/resource acceptance is pending. This change
is independently based on main; unapproved recognition/UI PRs are used only for
cumulative local testing. Production and scanner hardware are unchanged.
