# Inventory phone Search and suggestions

Issue [#910](https://github.com/sefaction/MTG-Archives/issues/910) is a positioning
defect: the suggestion list beneath the input can cover Search when the form
stacks on a narrow viewport. An actual 320px touch control fails on the unchanged
client because the first suggestion intercepts the tap. The fixture is removed
and six original-table fingerprints match; screenshot and trace remain private.

Three positioning classes anchor the popup below the entire form on narrow
layouts, leaving Search/Clear above it. At the existing `sm` row breakpoint,
the input label remains its anchor. The popup stays absolute, so blur/dismissal
does not move the action between pointer down and up. Suggestion/query state,
selection, keyboard handlers, filter preservation and server APIs are unchanged.

`tests/ui/inventory-quick-search-popup.spec.ts` uses an explicit immutable local
review-container/database target, synthetic owner and private sentinel owner.
Twelve cases cover actual touch/mouse Search with loading/settled suggestions
on Private/Public Inventory at 1366/390/320px. Eight phone cases preserve touch
option selection, ArrowDown/Enter, ArrowUp/Enter and Escape/Enter. Search cases
keep the popup open until the real action, assert the typed partial query and
other filters, reject the private sentinel and check page containment/errors.
No forced click, pre-click dismissal or suppressed suggestions qualifies Search.

Only loading-response timing is controlled; settled cases use ordinary API
responses. Temporary fixture sessions test normal stored-session resolution,
not password-login middleware. Every case checks complete original Inventory,
audit, location, user, player and card fingerprints after exact owned cleanup.
This is browser/software coverage at narrow widths, not physical phone or
full accessibility certification.

The feature branch starts from current main `51f810c3`. Cumulative local review
also includes qualified [#909](https://github.com/sefaction/MTG-Archives/pull/909)
at `b62df4f2`; its incremental-loading fix is separate from this PR. Local review
head `903e7785` copies the exact new Quick component and popup test over that
parent. Source manifests must bind both inputs; the cumulative image is not
represented as a standalone build of the feature branch.

Twenty-three focused existing style/compact/scroll checks and changed-file lint
pass. The cumulative build passes compilation, types, static generation and
client manifests in a dedicated 2 GiB/no-extra-swap/one-CPU builder with a
1536 MiB JavaScript heap. Local lint ran separately; canonical final-head CI
remains a readiness gate. There were no Docker OOM kills. Owned builder/cache
was retired after preserving its log, counters and cache manifest.

All ten corrected Private cases pass, with exact fixture cleanup and original
six-table conservation. Desktop/phone open-popup screenshots were inspected.
The original combined #908 phone trigger also loads all twelve narrowed rows
on the cumulative candidate without Escape, a forced click or suppressing the
popup. The test's supported Language filter is preserved. Its first matrix used
an unsupported `condition` query parameter; those later assertion failures are
preserved, not called passes. Correcting the test data/parameter changes no
application code and does not justify a repeated application build.

Anonymous Public acceptance remains **blocked**, not passed or replaced by an
authenticated test. Seven initial settled/keyboard cases cannot receive
options: `/api/inventory/filter-suggestions?public=1` returns actual HTTP 401
before the public branch runs. Independently actionable routing issue
[#911](https://github.com/sefaction/MTG-Archives/issues/911) records the source,
response and required privacy/authentication controls. The recorded work
allocation reserves shared routing to the desktop; specific assignment for
that repair is requested. No shared routing change, fake session workaround
or suppressed suggestion response is implemented by this client batch.

The cumulative image binds 1,225 declared inputs at `903e7785` with digest
`0e5128bc084d1970607854169ff9c4e712477c79b46a82a2570ae25c260da638`.
Its application Quick component exactly matches this feature branch; the
later browser fixture correction is test-only and runs outside the image.
The other cumulative application change is #909's separately qualified
InventoryBrowser. Full feature/cumulative input differences are recorded in
the private source binding, rather than claimed as a standalone feature image.

Keep the PR draft and #910 open until the complete Private/Public acceptance
is qualified or an explicit reviewed disposition is agreed. Canonical final-head
CI, independent/Brian review and individual merge approval remain separate.
No production deployment or human acceptance is implied.
