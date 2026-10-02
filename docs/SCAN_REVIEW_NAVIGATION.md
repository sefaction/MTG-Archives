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