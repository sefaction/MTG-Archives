# Re-running recognition

On **Imports → Batch dashboard**, choose **Re-run my pending batches** and
confirm once. This covers your own eligible unconfirmed scans across all batches,
regardless of the current search, page or list filter. An administrator using
this control still selects only their own player’s batches.

With **Admin Mode** enabled, the **Admin overview** separately offers
**Re-run all users’ pending batches**. The server checks the live administrator
role as well as Admin Mode; client-supplied owner or administrator fields cannot
expand access.

Both controls preserve saved printing reviews, Inventory quantities and receipts,
original scan bytes, and existing manual card boundaries. They skip reviewed,
committed, excluded, cancelled, trashed, deleted, inactive-account and unavailable
sources. Scans must have a retained, ready original for the current capture
generation and completed source preparation. New scans arriving after the
request are handled by ordinary recognition rather than this rerun.

The request is durable: after submission you can leave the page. The ordinary
acquisition preparation worker expands it in transactions of at most 40 cards,
then existing OCR, image, catalog and printing workers process it using their
normal fairness and lease policies. **Queueing complete is not recognition
complete.** The control reports cards queued; results and any stage failures are
shown in the batches. A missing worker leaves durable work waiting.

Retry a failed or interrupted submission with **Retry same request**. Its frozen
request ID prevents repeating an already accepted operation. Concurrent intake
is serialized across web and worker replicas; another actor/scope must wait
until the active request finishes queueing. After queueing finishes, a newly
confirmed request intentionally starts another pass.

Each chunk rechecks live actor access, batch ownership, review/commit state and
the exact original generation under the same batch lock used by human saves
and processing publication. Role revocation or owner reassignment cancels the
remaining instruction. Already queued evidence remains subject to ordinary live
worker access and revision fences. A transient database failure rolls back the
chunk/cursor and retries; it does not cancel the instruction or clear a review.

Deployment requires the additive `20261120210000_acquisition_recognition_rerun`
migration and updated web and acquisition preparation worker code. Existing
models/indexes and native algorithms do not change for this feature. Updating
production and forcing recognition there remain separate operator actions.
