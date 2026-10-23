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
Inventory paging, scroll and selection checks pass with the repair. All seven
product/test-head CI jobs pass in run `39957963796` at `8a81c29e`.

The local production image passes compilation, type checking, static generation
and client manifests. Its first attempt exhausted a 1 GiB JavaScript type-check
heap and aborted; Docker recorded no OOM kill. The diagnosed retry retained a
2 GiB/no-extra-swap/one-CPU builder, assigned 1536 MiB to JavaScript and skipped
only simultaneous duplicate lint, reusing the complete exact-head CI lint/build
result. All other build checks ran. Builder environment/command adaptations are
explicit; this is not an unchanged-recipe binary-reproducibility claim. Owned
builder/cache was retired after preserving logs, counters and its cache manifest.

Eight Private/Public, desktop/320px delayed-success/failure cases pass on the
candidate, including return to the original query while its first request is
still held. Normal retry and selection preservation also pass. The first retry
run failed only because a status selector matched three labels; its retained
trace shows the selected checkbox and all 24 rows. The corrected unique-status
assertion passes without repeating the eight unaffected cases. Each case
removes its fixture and reproduces six original-table fingerprints.

Direct original-trigger checks load all twelve narrowed rows on desktop and
phone, with no page errors or stale rows; screenshots were inspected. The extra
phone run first exposed an existing autocomplete popup covering Search. That
pointer-interception failure is preserved separately under
[#910](https://github.com/sefaction/MTG-Archives/issues/910). The successful direct
phone check uses ordinary Escape to close suggestions before Search; it does
not qualify the open-popup pointer path. The eight versioned cases retain their
actual successful Search actions. No forced click conceals that separate defect.

The image's 1,224 declared inputs at `8a81c29e` have digest
`ff44b3959aaaba9ccd30ca6dac1ace318874bced6f7a696b35b06c8efc26e9b3`.
The later author revision changes this report/checkpoint and the one test-only
status selector; every application input remains identical. The test runs
outside the image. A new application rebuild would add no relevant evidence;
required final-head CI is tracked on the PR and must pass before readiness.
Independent review and Brian's individual merge approval remain review gates.
Earlier failure artifacts stay private and are not overwritten by later runs.
No historical #721 diagnosis, production deployment, merge or human acceptance
is claimed.
