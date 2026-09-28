# Strong printing confirmation

User decision, September 27: strong matches confirm automatically, with an
opportunity to correct them. Confirmation stages a decision; only the final
explicit Inventory action creates stock.

## Workflow

Save batch finish and condition. As each photo is processed, a strong printing
match becomes **Automatically confirmed**, with its name, set, collector number
and attributes visible. **Correct match** opens the selected printing and lets
you change printing, finish or condition. **Keep pending** prevents automatic
reconfirmation of the current photo. A retake is new evidence and can qualify.
Existing manually saved decisions are never replaced. Changing batch defaults
affects future confirmations; saved cards retain their values.

Missing defaults or a default finish unavailable for that printing require an
attribute choice. Ambiguous cards still show **Review card**. Select the cards
(or use the existing select-all control), stop capture, preview, and explicitly
add the batch to Inventory. Automatic recognition never adds copies by itself.

## Evidence rule and limits

The versioned resolver requires a normalized exact title (not fuzzy or substring),
one observed set, one collector number preserving suffixes, one printed language,
and exactly one matching paper catalog entry for those identifiers. Conflicting
names or metadata, duplicate identities and unavailable languages cannot qualify.
Uniqueness is evaluated before the twelve-proposal display limit. A name match
alone never proves a printing, even if the local catalog only returns one card.

This is a metadata agreement rule, not a calibrated confidence percentage or a
guarantee of correctness. Old cards without readable set/language text still need
review. Condition and finish are user choices; the photo does not infer them.
Resolver version 3 also retrieves List records by their printed-origin footer
(for example `PLST MOM-210` alongside `MOM 210`). A possible stamped counterpart
requires review: the OCR pipeline has no validated stamp detector. Even a lone
List record cannot auto-confirm from the original footer. Version 2 jobs are
excluded from future automatic confirmation; unreviewed photos get a new job.
Existing saved reviews and committed Inventory are not rewritten. The user can
use Correct match on an earlier automatically saved decision.

**Benchmark correction, September 27:** Krosan Vorine, Saber Ants and Timberland
Ancient in the original ten photos are stamped reprints. Earlier labels used
the original footer and were wrong. The old four-correct-automatic-matches claim
is withdrawn: Timberland Ancient was an incorrect automatic original-print
choice. See the recognition comparison for corrected measurements. The guard
addresses that known failure, not general OCR accuracy or complete stamp detection.

## Worker and history

The recognition worker reconciles at most 25 eligible completed jobs per pass.
It repeats session/owner/creator activity, photo digest/generation, candidate
revision, receipt absence, current catalog and supported-finish checks under the
session lock. It records system confirmation separately from human review, with
job ID and defaults revision. History, candidate and session revisions commit
atomically. Repeated/concurrent passes are idempotent. Ineligible attempts are
recorded per defaults revision so they cannot starve later jobs; changing defaults
can retry them. No schema migration or production configuration change is needed.

A human pending/correction command for the same photo prevents reconfirmation.
Retakes invalidate old generation output. Explicit commit still revalidates
attributes/count/capacity and a correction invalidates its previous preview.

## Validation

The mechanical acquisition suite includes strict metadata/ambiguity cases,
unknown/unsupported defaults, concurrent workers, injected transaction failure,
human pending across reprocessing, old-generation exclusion, manual correction,
stale preview refusal and explicit corrected receipt. The real-photo browser
fixture checks automatic confirmation and correction alongside the existing
manual review and duplicate-safe Inventory flow. Results belong in the PR and
work checkpoint; the supplied ten photos are development samples, not held-out
accuracy evidence.
