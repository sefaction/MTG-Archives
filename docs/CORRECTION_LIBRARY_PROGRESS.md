# Refresh correction-photo progress

Issue673 reproduces a stale library after a pending original becomes preserved: the authenticated API has the new state, but the open page still says waiting and offers no original-view action until a browser reload.

Correction photos now offers Refresh photos. Refreshing retains the owner, current page and existing original/history inspection; only examples no longer present in the returned page lose their open inspection or removal prompt. A failed refresh leaves the current examples visible and offers Retry. Refresh, pagination and mutations cannot overlap while the list read is pending. Changing owner or page aborts obsolete reads and clears the old inspection context.

This is an explicit progress refresh, not background polling. Preservation, private access, recognition, label verification, sampling, allowances and Inventory rules remain unchanged. The branch is stacked on the separately unapproved review-history PR672; cumulative local review also retains separately unapproved original-retry PR671. Each needs individual approval before merge.

Qualification is in progress. The baseline used an owned synthetic example and controlled preservation transition to isolate client refresh behavior. New desktop/phone coverage uses the real library API and saved records, plus controlled photo transport and a failed/delayed list response. It checks second-page retention, newly available originals, open inspection through failure/retry and withdrawal, disabled overlapping actions, and disappearance of an inspected example after removal. Final core, cumulative Docker, browser and conservation evidence remains required before delivery.
