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
cases remain required.

## Final bounded qualification

Implementation992da12 passed full isolated acquisition90639ms/shared import
54450ms/core95763ms,811 unit tests and owned cleanup; all three GitHub checks
passed. The first oversized single-photo quota setup was correctly rejected by
the existing10MiB database bound; its failed verification and successful cleanup
remain preserved. Corrected quota fixtures use many individually valid records;
no constraint or production limit was relaxed.

Cumulative local Docker matches all547 build inputs, digest
`d27cc5908e2194e725b7e96b38281905de93e773f6257569b924c766fbc2aa9b`.
Only web was reloaded;12 other service identities/images remained unchanged.
Four affected browser cases passed in1.3minutes, with no skipped cases: library
capacity/concurrency, transient/lost-ack/reload upload recovery, counted refill
and section-series Stop.

The fresh unchanged300-input/four-owner160/80/40/20 native test **PASSED**,
10:05:05.978–10:38:16.823UTC, actual Playwright exit0,33.4minutes and no skips.
All300 photos/artifacts/slots/candidates and ordered original digests were ready
in99.524seconds. Five readable reservation409/retryable conflicts recovered;
there were zero failed photo responses or emitted photo-failure stages.
All300 printing checks completed in1962.422seconds from test start, within the
unchanged45-minute post-upload limit. Original/native digests, review-only
outputs, all300 paged review rows and each owner's LP correction/reload passed.
There were no new worker restarts/OOM events or worker identity/image/start-time
changes. Historical printing RestartCount3 remained unchanged.

Owned cleanup left zero fixture users/sessions/Inventory and zero private input
directories. Existing user Inventory, Batch545, Batch546 and all30 physical scan
originals remained conserved; all67 source originals were hash-checked again.
Desktop1366px and phone390px screenshots for the largest/smallest batches were
inspected; all four owners passed automated horizontal-overflow checks.
Eight authenticated empty-owner Inventory requests returned200 in48–874ms.
Those are individual development samples, not p95 or150,000-copy review evidence.
Private reports/logs/screenshots remain outside Git.

This qualifies this bounded upload/native/review case. The67 repeated development
originals do not establish independent exact-printing accuracy, physical counts,
unattended feeding, or the broader image release/recovery matrix.

## Follow-up actual OCR interruption

The existing24-image local restart test also **PASSED** on this unchanged loaded
runtime,10:45:41.938–10:51:37.464UTC, actual exit0,6.2minutes and no skips.
It saved an LP review and froze its completed evidence, dropped one acknowledgement
after a real successful upload, then deliberately SIGKILLed the OCR container
during an owned test job and restarted the same image. The genuine lease expiry
was left unchanged; the interrupted job recovered on attempt2 after attempt1.
All24 photos/artifacts/slots/candidates and original/native digests passed,
with no visible upload retry, duplicate candidate or Inventory addition. The LP
review and frozen evidence survived. All24 development labels were first-offered;
this reused sample is not independent accuracy evidence.

The intentional OCR restart happened after the completed native300 interval;
it does not alter that interval's stable before/after result. OCR is running on
the same image, with new start time10:46:43.003877205UTC, RestartCount0 and
OOMKilledfalse. Post-test owned users/sessions/Inventory/locations/photos were
zero, the native queue was empty, and the existing user Inventory checksum was
unchanged. The broader host/database/server/storage recovery matrix remains open.

No production operation, physical scanner feed or merge has occurred. The
separately passing100-image gate in draft635 does not qualify this new change or
erase any preserved failure.
