# Acquisition upload continuity

Parallel300-image uploads across four accounts exposed [issue636](https://github.com/sefaction/MTG-Archives/issues/636).
Three unchanged stress attempts failed the five-minute upload gate at291,290 and
291ready images. All300 originals had reserved photo records; unfinished photos
remained in the browser with Retry upload. Full native300 processing/review was
not reached. Fixtures were removed and user Inventory/scanner batches conserved.

The third run recorded98 failed photo responses and27 failed reservation responses
inside the browser. Every recorded body was available and explicitly marked409,
retryable, with the generic request message. The ordinary finite retry budget was
exhausted for remaining uploads. PostgreSQL recorded serialization conflicts;
the first attempt alone had1,879, including internally retried operations.
These results are retained privately and in the October4 qualification ledger.

Upload writes previously hydrated every earlier candidate, observation, artifact,
event and correction in the batch inside their serializable transaction. Native
publication on unrelated cards therefore expanded the upload's conflict surface
and the work needed before saving one accepted original.

The upload-only read now scopes those relations to the affected reserved physical
candidate and that photo's event. It retains the candidate's complete historical
observations/artifacts for retakes, review invalidation and replay. Ordinary batch
reads and admission still use the complete session. The existing domain reducer
and persistence path write only the changed candidate; earlier candidates/events
remain stored. Database uniqueness continues to enforce physical order and event
identity. Owner authorization, session locking, quota locking, serializable
isolation, finite retries/deadlines and worker/Inventory fences are unchanged.

The disposable database regression finalizes accepted uploads concurrently after
Stop, beside a saved review and another card's proposal. It checks unchanged prior
rows/events, cross-owner rejection, four distinct candidates for identical bytes,
all four ready images and exactly four events/observations/jobs after receipt
replay. Existing retake, stale generation, injected rollback and cancellation
cases remain required.

The opt-in native test captures redacted response classifications from browser
response clones because CDP could not retain every photo response body. It records
no request bodies, URLs, credentials, arbitrary error text or image data. Missing
diagnostics are labelled unavailable, and cannot prevent owned cleanup. Upload
counts, native completion deadlines, queue fairness and acceptance remain unchanged.

At implementation time type/lint checks pass; full database/core verification,
cumulative Docker and fresh four-owner native stress qualification are pending.
No runtime reload, production operation, scanner feed or merge has yet occurred
for this batch. The separately passing100-image gate in draft635 remains valid;
it does not qualify this pending change or erase the preserved stress failures.
