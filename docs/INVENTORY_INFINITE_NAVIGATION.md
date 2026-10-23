# Inventory incremental loading across navigation

Issue [#908](https://github.com/sefaction/MTG-Archives/issues/908) addresses a
client loading-state defect, separate from the historical streamed-page
investigation [#721](https://github.com/sefaction/MTG-Archives/issues/721).

On main `51f810c3`, hold the actual page-two response during infinite browsing,
then submit a narrower quick card-name search. The new first page renders, but
the old loading flag remains set. Releasing the old reply does not clear it
because the query changed. The new list never requests its remaining rows.

A disposable 24-printing fixture reproduces ten of twelve narrowed rows with
“Loading more…” and no new page request. All fixture records were removed and
six original-table fingerprints matched. The initial cleanup harness missed
the app-created Unassigned location; exact owned recovery and the corrected
conservation result are retained privately. This failed setup is not a pass.

The fix assigns incremental requests a monotonically increasing identity.
Receiving a server page resets loading and invalidates previous requests.
Success, failure and finally handlers act only for the current request and
query. Returning to the same query does not restore an old request's authority.
An observer callback retained from an earlier query cannot start a new request.
Unmount also invalidates outstanding work. API semantics, writers, permissions,
selection policy, quantities and database schema are unchanged.

`tests/ui/inventory-infinite-navigation.spec.ts` exercises the actual production
client and list API with disposable synthetic cards. It delays real responses,
navigates through a narrower query and back, holds the new request, then
releases an old success or injected failure. It asserts no stale rows/error,
continued current loading, complete paging, desktop/phone containment,
and normal HTTP-error retry with retained selection. Private and anonymous
Public consumers are covered separately. Only response timing and selected
failure transport are adapted; authentication uses a short-lived fixture
session, so this is not password-login qualification.

The opt-in runner requires an immutable local web-container ID and a verified
review database name through `MTG_INVENTORY_TEST_CONTAINER` and
`MTG_INVENTORY_TEST_DATABASE`, plus `PLAYWRIGHT_BASE_URL`. It refuses unbound
targets, never changes an existing account, and compares original Inventory,
audit, location, user, player and card rows after exact owned cleanup.

The identical versioned private/desktop success case fails against the
unchanged image because no new page request is issued. Twenty focused existing
Inventory paging, scroll and selection checks pass with the repair. Candidate
production build, full browser matrix, exact-head CI and independent review
remain pending at this author checkpoint. Earlier failure artifacts are kept
privately, not overwritten by later runs. No historical #721 diagnosis,
production deployment, merge or user acceptance is claimed.
