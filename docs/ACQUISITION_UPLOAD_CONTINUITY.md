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
identity. Owner authorization, session locking, quota locking, finite
retries/deadlines and worker/Inventory fences remain required.

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

## Preserved repair attempts

The first scoped-read implementation44c5ce6 passed full isolated database/core
checks, all three CI checks, exact546-input local Docker provenance and six browser
cases. Its fresh300-input attempt still failed upload at294/300 ready.

Revisione96afeb spread database retries within their original15/30/60/120/240ms
caps and added fixed-stage diagnostics. Nine focused tests, full isolated
acquisition130503ms/import47803ms/core80372ms/cleanup, all three CI checks and four
affected browser cases passed. Exact546-input local Docker digest was
`4b6965f8575549ff09ca66523ecfeed0caee1b9827516939919a7799f028e28b`.
Its fresh unchanged300-input test **FAILED**,09:42:59–09:48:08UTC, at293ready
(158/78/37/20). Full native300/review was not reached; owned cleanup was all zero.
Safe service diagnostics classified12 exhausted BEGIN and77 FINALIZE conflicts,
all retryable P2010/40001 or P2034. Neither narrower reads nor jitter alone fixed
the defect. Their private reports, logs and screenshots remain preserved.

## Explicitly locked photo saves

BEGIN and FINALIZE now use Read Committed inside a dedicated helper which
authorizes, takes the session row lock, and repeats scoped reads and authorization
after waiting. Other acquisition transactions, including slot admission, stay
Serializable. This is an explicit isolation change limited to the two photo-save
operations, not a global fallback or an extra retry allowance.

The audited slot/candidate writers, native publication, human review, commit,
batch cancellation and expiry all take the same session lock. BEGIN additionally
holds the existing owner quota advisory lock through both byte aggregates and
the insert. Reads after that wait see the previous intake's committed bytes.
Uniqueness, generation, receipt replay, accepted late-transfer and expired-batch
checks remain in the locked transaction. No irreversible Inventory operation is
introduced.

PostgreSQL documents that Read Committed statements get a fresh snapshot, while
Serializable snapshots can fail after waiting on a changed row and require a
full retry. Applying fresh reads under the existing invariant locks here is an
implementation decision supported by the stage evidence and writer audit; it is
not a claim that Read Committed is sufficient for arbitrary acquisition work.
See [transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
and [explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html).

New disposable regressions deliberately expire a batch between initial read and
lock, and race two intakes for the last available bytes within one session and
across different sessions of one owner. Accepted unready reservations count;
only one contender may fit. Quota metadata is restored and fixtures cancelled.
Existing rollback, retake, replay, foreign-owner, cancellation and scanner drain
cases remain required. Full verification, cumulative Docker/browser checks and a
fresh unchanged300-input gate for this final refinement are pending.

No production operation, physical scanner feed or merge has occurred. The
separately passing100-image gate in draft635 does not qualify this new change or
erase any preserved failure.
