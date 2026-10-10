# Public inventory name-browse metadata

Resolves [#723](https://github.com/sefaction/MTG-Archives/issues/723). Related
[#721](https://github.com/sefaction/MTG-Archives/issues/721) remains unresolved.

Public inventory previously retrieved fifteen sort/filter metadata fields for
every matching printing, even for ordinary name browsing. The query now selects
only id, name and oracleId when sorting by card name without color,
color-identity, keyword or price post-filters. Every other sort/filter retains the
complete previous projection. Full visible-page and drawer hydration, SQL
constraints, public visibility, grouping, sorting, totals and pagination stay
unchanged. No schema, private Inventory, recognition or Inventory-write change
is included.

## Evidence and qualification

- The actual loaded unchanged build completed six fresh desktop/phone
  Clear-filters cases within the existing ten-second assertions, with zero
  retries/skips/failures. The original historical stall remains unexplained;
  this change does not establish its cause or resolution.
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
- Required-installer cumulative Docker build, actual loaded-runtime browser
  and original-data/service conservation gates are pending. No local image is
  claimed qualified merely because a build starts.
- Final-head GitHub checks are pending; readiness follows completed
  qualification, with individual approval/merge handled by the scheduled reviewer.

Private evidence is under feature `.local-data/paired-query.*`,
`repeat-browser.*`, `baseline-browser.*`, `core.log` and cumulative review
`.local-data/`. No private collection images or authenticated data are published.
An initial paired-probe quoting error and cumulative setup/build interruption
are retained as setup failures and do not count as acceptance passes.

## Local cumulative review

Checkout `.local-data/worktrees/public-metadata-review`, branch
`local/cumulative-public-metadata-723`, starts from cumulative `0288029` preserving
the previously loaded #718/#719 and now-merged #715/#722 scopes. All 597 runtime
inputs match the qualified predecessor except `lib/public-collection.ts`.
The source digest changes from
`30a14b91d8c3b9b9f5232b8777a75078d28ce7a886731abfcbec5247605ddd1c` to
`a7377bcfbcf24f81e5d6f8774152a70537799bcb5b76f9beaad08252dc76cddb`.
The preexisting other-worker layout WIP is copied into this separate review
checkout; the original worktree is preserved. Application dependency on either
unmerged PR is not introduced by the name-metadata change.

Only web may be replaced after exact packaged/current-source and environment
checks. The other fifteen ordinary-project service identities, lifecycles,
mounts/limits and all seven original collection/acquisition projections must be
conserved. This does not authorize production deployment or a PR merge.
