# Acquisition worker turns and progress

## Observed problem

Issue #483 reproduces a saved 90-image Card scan batch whose canonical work was
complete while all text and visual jobs remained pending. Healthy serial workers
were processing older unreviewed batches after recognition/reference changes.
Global FIFO made the new batch wait for those whole backlogs. The review screen
also claimed catalog/stamp work was underway before those jobs existed.

## Queue behavior

Each eligible run now has a persistent last-claimed turn for each processing
stage. The worker chooses among the least recently served runs, keeping
availability and FIFO order within each run. Two heads per run allow concurrent
workers to continue after losing a lease compare-and-swap. Normal workers still
claim one bounded job per tick; this does not increase native concurrency or
promise an exact first-result time.

The job lease and turn are recorded in one database transaction. An unsuccessful
claim does not spend a turn. Restarting a worker retains scheduling state.
Stage-specific turns keep canonical, OCR, visual, catalog and printing work from
interfering with one another's ordering. A cascade removes only queue bookkeeping
when its acquisition run is removed. Originals, observations and older jobs are
retained. Retry deadlines, ownership/session eligibility, revision fences and
explicit Inventory commit are unchanged.

Review distinguishes queued identification/image comparison from running work.
Catalog status is absent until catalog work supplies evidence or is actually
queued. Printing status is shown when that job exists; a future WAITING stage is
not presented as a started stamp check. Earlier suggestions remain reviewable
while supplemental work is pending, and incomplete verification blocks automatic
confirmation.

Previously saved OCR observations can contain a CHECKING placeholder. The review
adapter ignores that placeholder until an actual catalog job exists, preserving
the stored native observations and text suggestions. No re-recognition or photo
replacement is needed to correct those status labels.

## Verification

- Disposable PostgreSQL: a new batch gets a turn ahead of 99 older jobs; another
  old job still runs next. Reconnecting retains turns, and another stage starts
  independently. Existing two-worker CAS, expired leases, retries, cancellation,
  human-review fencing, capacity and receipt checks also pass.
- Complete local database/core verification passed in185.426seconds with owned
  fixture cleanup. An earlier run passed database checks but caught a fixture
  TypeScript annotation error; the final run fixes it.
- Native local browser acceptance passed1/1 in9.6minutes using the real shared
  backlog, without changing fixture-job availability. Four actual scan cases
  reached printing/review; the full-image mode, digest/pair identity and unchanged
  Inventory were verified. Both1366/320 screenshots were inspected.
- Final read-only browser check on the user's saved batch passed at1366/320:
  text suggestions remained visible with image work queued, without premature
  catalog/stamp labels. Screenshots inspected; no capture/review/Inventory write.
  Loaded451-file source digest is
  `16ee10583b019d404886326218c9b0f11e44e47b464e256bbfe8ee7ca05179ad`.
- Recognition algorithms, native descriptors, confidence rules and reference
  generation are unchanged. The new90-file accuracy corpus has independently
  recorded visible labels:67 playable cards/four stamps and23 art cards excluded
  from playable exact-printing scoring. Its accuracy evaluation is separate.

This addresses scheduling and honest progress. Serial CPU costs, provider waits
and the total amount of eligible work still affect batch completion time; it is
not a throughput or recognition-accuracy acceptance claim. Testing is local.
