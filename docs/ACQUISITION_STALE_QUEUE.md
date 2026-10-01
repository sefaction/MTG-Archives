# Retire obsolete queued inference

Issue #545. The latest scanner batch retained 34 originals, but initially only
its first card had completed recognition. Workers were active behind a historical
refresh backlog across 16 runs. End-of-run count reconciliation advanced queued
candidate revisions: obsolete OCR/visual attempts were still performing native
inference and only being rejected at publication as INPUT_CHANGED.

Non-canonical claims now retire queued or expired-lease attempts whose candidate
revision, exclusion, review or receipt makes publication impossible. Current
eligibility is checked before the bounded selection window and again in the claim
compare-and-swap. Live leases retain ownership and publication still has its
existing strict fence. Canonical preparation is independent of human review and
candidate revision because it prepares immutable photo bytes.

This does not change owner/run turns or priority policy, delete originals, alter
reading zones or save reviews/Inventory. The focused new-scan versus historical
refresh priority question is pending the user's answer.

Validation: cumulative typecheck/753 units pass; complete isolated PostgreSQL
acquisition integrity passes, including four-owner fairness, concurrent claims,
leases/retries/timeout, canonical-after-review, stale-before-handler guard,
publication after review, reconciliation, scanner receipts and explicit Inventory.
The first run found the retry fixture still using its previously reviewed card;
retry/crash/timeout tests now use a fresh unreviewed card while the deliberate
stale-after-review publication case remains. Owned test database was removed.
Local Docker/native acceptance and PR/checkpoint hold final loaded provenance.
