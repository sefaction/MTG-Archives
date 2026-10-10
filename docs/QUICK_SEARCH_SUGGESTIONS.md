# Quick card search suggestion ownership

Issue [#716](https://github.com/sefaction/MTG-Archives/issues/716), resolving PR
[#718](https://github.com/sefaction/MTG-Archives/pull/718).

Quick card name search retained options from the preceding query throughout the
next query's debounce and fetch. Pressing Enter could therefore search for a
previous suggestion rather than the current input. Inventory and Public inventory
share this component.

Replies now carry a key containing the trimmed query, suggestion endpoint and
server filter parameters. Only a reply matching the current key is displayed or
used by keyboard navigation. Empty inputs expose no options. Loading status uses
the same key, and an explicitly aborted request cannot update options after its
JSON body resolves. Enter without a current option uses the existing form search.
The existing filter/navigation/pagination behavior is preserved.

## Qualification

- Actual Chromium component probe: unchanged `origin/main` submitted `Forest`
  with one visible old option after the input changed to `Island`; the fixed
  component submitted `Island` with zero old options. Both observations satisfy
  the probe's distinct baseline/fixed expectations. This mounts the actual
  component with isolated router/workspace adapters, rather than a full server.
  Evidence: feature `.local-data/component-probe.json` and probe script.
- Full local core verification: Prisma generation, typecheck, all 877 unit tests
  (zero failures/skips), production build and all 13 client-manifest guards pass.
  Evidence: feature `.local-data/core.log`.
- Actual unchanged Docker baseline: the 1366px Public case intentionally fails
  its unchanged Island URL assertion because Enter navigates to `cardName=Forest`
  (14.4s). Log, JSON, trace, video and screenshot remain separate under cumulative
  `.local-data/baseline-browser.*` / `baseline-artifacts`.
- Fixed cumulative Docker: all five new browser cases pass (19.1s), zero failures,
  skips or retries. Responses are held explicitly rather than relying on timing.
  Public and signed-in Inventory cover 1366px and 320px. Language, set scope,
  display, page-size and sorting survive; pagination resets. Additional Public
  coverage exercises superseded replies, clearing, current arrow/Enter and
  pointer choice. Empty-result scope keeps this interaction test independent of
  the separately reported full-collection navigation issue #721.
- Existing real-data Inventory workspace and Public parity cases both pass
  (30.4s), including composed search, filter/history context, accessible phone
  filters, real visible/private collection boundaries and fixture cleanup.
  Four new desktop/phone screenshots were inspected.
- Required-installer Docker production build and all 13 client manifests pass;
  the preserved 0.4.3 scanner installer verifies. Guarded web-only load checks
  exact source, unchanged environment and current cumulative baseline before
  replacement. Container health and host `/login` HTTP 200 pass.
- All seven full original table projections are conserved, as are the identities,
  images, lifecycles, mounts and limits of the other 15 retained ordinary-project
  containers (12 running and three stopped). Web mounts/limits are also conserved.
  The two existing fixture namespaces have zero users, players, locations, cards
  and decks afterward. Authentication sessions are outside the collection
  projections. No fresh original-photo byte audit was needed or claimed for this
  collection-search change.
- All three GitHub checks passed on browser/source head `837ed4e` in
  run `38076675909`; final documentation-head checks are tracked in the PR and
  local checkpoint before ready status.

Snapshot/manifest setup failures involving generated SQL quoting, composite keys
and the Windows runner path are preserved in private `setup-failures.md`. They
caused no application mutation and are not counted as application acceptance.

## Cumulative local review

Checkout `.local-data/worktrees/quick-search-review`, branch
`local/cumulative-quick-search-716`, integrates main `5e7adbf` with PRs
#715/#718/#719/#722. The separately loaded default-off maintenance specimen for
PR #720 remains untouched. Cumulative commit before the final documentation merge
is `1a63fd96b3fa6de4f98d939b297dd456ce9ab190`.

Web image:
`sha256:0d38142996e5d8febe26562b1c999578e38a59c69d916ea21a4de0de8e50a57c`.
The 597-input manifest digest is
`30a14b91d8c3b9b9f5232b8777a75078d28ce7a886731abfcbec5247605ddd1c`.
Every prior loaded app input is unchanged except
`components/InventoryQuickCardNameSearch.tsx`, whose bytes exactly match the
feature checkout. Private cumulative line-ending alignment preserves the already
loaded Public layout bytes; that layout is not part of this feature PR.

The five new tests use read-only collection routes and controlled autocomplete
replies. The two existing regressions create and remove their own collection
fixtures. Local snapshot login is used for signed-in Inventory coverage.
Production data/configuration, scanner operation, recognition and database schema
are outside this batch.

The issue remains open and in-progress while its PR awaits the scheduled reviewer
and individual human merge approval.
