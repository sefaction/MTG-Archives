# Saved photo review

The local Imports → Scan cards workspace confirms strong exact printing matches
with saved batch defaults and supports correction of any saved card. Ambiguous
cards need individual review. Confirmation alone never writes Inventory. See
[automatic confirmation](ACQUISITION_AUTO_CONFIRM.md).

## User workflow

1. Set and save the batch finish and condition. Unknown values are allowed while
   capturing but cannot be accepted as a completed card review.
2. Strong matches show **Automatically confirmed** and **Correct match**. For
   unresolved cards, open **Review card**, choose the exact printing from explained suggestions or
   search the local catalog by name, set code and collector number.
3. Check condition and finish; override the batch defaults for this card as
   needed. The catalog supplies the printing language when known.
4. Save the review, or keep the physical card pending. Saving does not commit it.
   The batch counter includes both reviewed and pending cards.

Changing defaults applies to later automatic confirmations and prefills later
manual reviews. Previously saved decisions keep
their values. Editing a saved review starts with those saved values. Clearing it
with **Keep pending** preserves the same photo and physical slot, and prevents
automatic reconfirmation of that photo even after reprocessing.

## Integrity

- Current owner/Admin Mode authorization is checked on every read and write.
- Per-card revisions reject competing edits; an identical accepted retry by the
  same actor is replayed. Defaults use their own revision so unrelated uploads do
  not invalidate them.
- Review history and the decision commit in one transaction under the session
  lock. History records actor, photo and before/after values.
- Retakes invalidate older photo review requests. Only the current ready,
  unpurged photo can be reviewed.
- Selected paper printing, language and supported finish are checked server-side.
  No photo-based condition or foil inference is used.
- Preview preparation belongs to immutable photo bytes, independent of human
  review revisions. Recognition publication retains its strict revision fence;
  existing suggestions for the same bytes remain inspectable after review.
- Keeping a reviewed card pending allows a current-revision recognition attempt.
  Existing attempts are not retried indefinitely by discovery.

## Verification and limits

`npm run verify:acquisition` uses disposable PostgreSQL and includes defaults,
per-card overrides, authorization, unsupported printing attributes, identical
retry, competing edits, injected history failure/rollback, pending conservation,
recognition requeue and late preview completion. Inventory totals stay unchanged.

The opted-in real-photo intake browser fixture also exercises review persistence,
manual set/number lookup, changed defaults, stale-tab rejection, Escape/focus
restoration and 1366/390/320px dialog widths. It requires the private development
corpus and local CPU worker; see `ACQUISITION_RECOGNITION_RUNTIME.md`.

This does not complete all of P6: large-batch review filters/pagination, broader
physical reconciliation and selected-subset commit preview remain follow-ons.
Inventory commit, post-commit seven-day photo expiry and actual Android HTTPS
camera acceptance remain absent. No production deployment is included.
