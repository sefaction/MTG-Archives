# Public inventory loading and filter clearing

Resolves [#723](https://github.com/sefaction/MTG-Archives/issues/723). Addresses
the empty-result Clear-filters trigger in related
[#721](https://github.com/sefaction/MTG-Archives/issues/721); its separate private
Inventory loading observation remains unresolved.

Public inventory previously retrieved fifteen sort/filter metadata fields for
every matching printing, even for ordinary name browsing. The query now selects
only id, name and oracleId when sorting by card name without color,
color-identity, keyword or price post-filters. Every other sort/filter retains the
complete previous projection. Full visible-page and drawer hydration, SQL
constraints, public visibility, grouping, sorting, totals and pagination stay
unchanged. No schema, private Inventory, recognition or Inventory-write change
is included. The empty-result Clear filters link uses ordinary document
navigation to its existing target, preserving browsing options and browser
history while avoiding the stalled client-stream transition.

## Evidence and qualification

- The actual loaded unchanged build completed six fresh desktop/phone
  Clear-filters cases within the existing ten-second assertions, with zero
  retries/skips/failures. The original historical stall remains unexplained;
  the smaller metadata projection alone does not resolve it.
- The first added browser check passed navigation but failed an incorrect
  `Name` column label. Its snapshot showed `Card Name`; this test setup failure
  is retained separately and is not a stall reproduction.
- Three behavior-focused unit cases preserve oracle/name grouping and order,
  every supported sort in both directions, and metadata-dependent matching,
  including face colors, foil price fallback and zero price bounds. Types and
  full host core verification pass: 881 units, zero failures/skips, production
  build and thirteen client-manifest guards.
- Eleven actual read-only PostgreSQL old/new pairs return identical complete
  results, including exact/grouped, page two with descending name order,
  color/identity/keyword/price filters, other sorts and Scryfall query scope.
  The unchanged loaded source is checked against the feature's main baseline;
  proposed source is evaluated in a separate probe module without changing
  application files. Pair order alternates.
- For the 7,320 matching printings in default browsing, metadata JSON changes
  from 7,150,102 to 815,152 bytes (about 88.6% smaller). Development-snapshot
  exact/grouped calls measured 4,016/1,717 ms before and 1,307/428 ms after.
  These are bounded local observations, not production benchmarks. Other-sort
  samples vary significantly with concurrent host build load; their timing
  differences cannot be attributed to this unchanged fallback path.
- The first required-installer metadata-only image built and loaded with an
  exact source fence. An immediate browser attempt failed all four cases:
  three connection refusals before application startup finished and a parity
  fixture transaction setup timeout. These are retained failed attempts.
  Startup later preserved the existing admin account, completed normally and
  returned host HTTP 200; no reset or speculative startup change was made.
- Two warm metadata-only groups each passed three cases but failed one original
  ten-second Clear-filters URL assertion (phone, then desktop). The phone group
  overlapped an inadvertently started conservation read; the desktop group ran
  without that read. The phone trace records response headers after 152 ms but
  no completed streamed body before timeout. The client transition did not
  complete; the internal stop cause is not established. These
  failures justify the ordinary document-navigation repair and remain failures.
- The existing real-data Public privacy/parity case passed both warm groups,
  with owned fixtures cleaned. A terminal after-snapshot conserves all seven
  original table projections and fifteen other services. An earlier snapshot
  during a browser run is retained separately and is not final qualification.
- Fresh navigation-source types and all 881 units pass. A duplicate host
  production build was deliberately interrupted during compilation to reduce
  contention on the laptop; it is not a full fresh host-core pass. All three
  required GitHub checks pass on implementation commit `9005a59`, including
  production build. The required-installer cumulative Docker build also passes
  compilation, types, static generation and all thirteen client-manifest guards.
- The first scheduled run deferred loading while a supervised manual scanner
  test used the shared environment. The second run resumed after that chat
  explicitly released its shared-runtime deferral. A fresh baseline retained
  its intentional two photos/candidates/artifacts, one run, one Inventory row
  and one commit/member; historical pre-manual snapshots were not reused as
  the current conservation baseline.
- The immutable saved navigation image and all 597 source inputs matched the
  candidate manifest. Its sole delta from the metadata-only predecessor was
  the Public page. The guarded loader preserved environment/storage and
  replaced only web. Health and host HTTP 200 passed before browser tests.
- Actual loaded-runtime qualification passes: all four navigation/privacy
  cases in 23.4 seconds, then all nine repeated clearing cases in 25.3 seconds,
  with zero skips, failures or flaky retries. Desktop/320px clearing, browser
  Back, grouped browsing options, pagination reset and anonymous/authenticated
  Public privacy qualify. Original ten-second URL assertions are unchanged.
- After every browser runner terminated, all seven fresh original table
  projections, including the intentional manual-test rows, and all fifteen
  other service identities/lifecycles/mounts/limits were conserved. Independent
  player/user/location/card/deck fixture-namespace counts were all zero. Web
  remained healthy with zero restarts. No original-file byte audit, private
  Inventory loading resolution or production latency claim is inferred.
- Approved main `8f16a495` was integrated into the feature branch. Its quick
  search component and this batch's runtime bytes exactly match the qualified
  cumulative image, so the already built application image is reused. Final
  report-head GitHub checks govern readiness; individual approval and merge
  remain the scheduled reviewer's responsibility.

Private evidence is under feature `.local-data/paired-query.*`,
`repeat-browser.*`, `baseline-browser.*`, `core.log` and cumulative review
`.local-data/`. No private collection images or authenticated data are published.
An initial paired-probe quoting error, cumulative helper-copy error/build
interruption and phase-two source-fence rejection are retained as setup failures
and do not count as acceptance passes. The first image was interrupted before
loading; the second fence rejection prevented its build/load until corrected.

## Local cumulative review

Checkout `.local-data/worktrees/public-metadata-review`, branch
`local/cumulative-public-metadata-723`, starts from cumulative `0288029` preserving
the previously loaded #718/#719 and now-merged #715/#722 scopes. The final 597
runtime inputs preserve the qualified predecessor except
`lib/public-collection.ts` and `app/public/inventory/page.tsx`.
The source digest changes from
`30a14b91d8c3b9b9f5232b8777a75078d28ce7a886731abfcbec5247605ddd1c` to
`a7377bcfbcf24f81e5d6f8774152a70537799bcb5b76f9beaad08252dc76cddb`
(metadata only), then
`c4b7c9191cfc4154b9b0d381afea7fc899b6476dd15e32a231b29b8038077440`
(including document navigation).
The qualified, currently loaded navigation image is
`sha256:7a9dd2f42c3bfbf6e954bf051e82262e0a8fdc47794b4273c050a0730d10bf9a`;
it must be reconciled with this exact source manifest before loading.
The preexisting other-worker layout WIP is copied into this separate review
checkout; the original worktree is preserved. Application dependency on either
unmerged PR is not introduced by the name-metadata change.

Only web was replaced after exact packaged/current-source and environment
checks. The other fifteen ordinary-project service identities, lifecycles,
mounts/limits and all seven fresh original collection/acquisition projections
were conserved. This does not authorize production deployment or a PR merge.
