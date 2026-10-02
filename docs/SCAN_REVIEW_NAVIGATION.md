# Navigation to off-page scan review cards

Issue #573 reproduces a14-card batch with13saved reviews and card14awaiting review.
From Ready for Inventory, Next awaiting review changes the filter to All and asks
for14rows. The generic review-filter effect then resets the extent to12, removing
the target during the focus/scroll callback. Bulk Inspect or correct has the same
conflicting filter/extent path. Desktop1366px and phone390px both failed the original
10-second focus assertion on the unchanged loaded application.

The fix confines automatic extent reset to a new batch. Manual Show cards changes
explicitly reset their page to12; intentional navigation retains the larger extent
it requested. Filtering, incremental scroll loading, saved/draft classifications,
physical ordering, scanner control, recognition and explicit Inventory rules remain
unchanged. Both existing target-navigation paths benefit from the same narrow fix.

The owned browser regression uses real persisted originals,13explicit saved reviews,
and one controlled unreviewed proposal. It checks target focus/viewport, manual
filter reset, bulk inspect, dirty LP draft continuity/refresh, unchanged saved review
revisions and14original digests, destination and zero Inventory on desktop/phone.
These presentation fixtures do not qualify native recognition or physical feeding.
Routing drains before owned fixture deletion to avoid baseline cleanup-time404s;
both original navigation failures and the secondary404 remain retained separately.

Required core/Docker/source and final affected browser evidence is recorded below
when complete. This batch stays unmerged until its individual approval.
## Qualified local result

The cumulative image passed all 764 unit tests (zero skips), typecheck, lint,
host build and ten build-input manifest checks. Docker build required the real
scanner installer and passed. All 19 affected desktop/phone browser checks passed
with zero skips in 6.4 minutes, including both new navigation cases and existing
draft, correction, bulk, recovery, scanner start/retry and installation coverage.
Phone screenshots were inspected; the target is visible and the layout stays
within the viewport. The rendering fixtures deliberately use synthetic originals.

Local image: mtg-archives-web:paged-review-navigation,
sha256:3c21cf0216425d706e111445257f62cf0926c08d5e65161f6d15472c5c74b716.
All 510 build-input sources match digest
02cc3f3c103678e8f7f66eb0689b54aceeca31b68bad7bfe485b88c3f8ee0006.
The application includes the preceding unmerged native-source, recovery and
claim-diagnostic batches. Documentation/test-only commits do not change this digest.

After every owned browser fixture was removed, the original 10,280 Inventory rows
(12,482 copies), 81 saved reviews and 907 photo identities/digests matched the
start-of-night hashes exactly. Native 100-input throughput remains FAILED at
50/100 within 20 minutes; this navigation pass does not supersede that result.
No physical source, production deployment or merge was performed.
