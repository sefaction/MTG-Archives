# Inventory phone Search and Public suggestions

[PR #912](https://github.com/sefaction/MTG-Archives/pull/912) addresses
[#910](https://github.com/sefaction/MTG-Archives/issues/910) and
[#911](https://github.com/sefaction/MTG-Archives/issues/911).

Three positioning classes put phone suggestions below the entire stable form,
leaving Search reachable. Desktop suggestions remain anchored beneath the input.
The absolute popup does not move the button during blur or dismissal. Search,
selection and keyboard handlers retain their existing behavior.

Brian explicitly authorized the specific Public-suggestions routing repair.
Quick and Advanced Public search now use
`/api/public/inventory/filter-suggestions`. This facade forces `public=1` before
calling the existing validated, public-visibility-constrained query. Caller flags
and sessions cannot switch it to private scope. Private endpoints and middleware,
schema, quantities and writers are unchanged.

## Author qualification

- Twenty-three existing style/compact/scroll checks, ten public read-only checks
  and changed-file lint pass.
- Twenty real browser cases pass: Private and genuinely anonymous Public,
  desktop/390/320px, loading/settled Search, suggestion taps, ArrowDown/Enter,
  ArrowUp/Enter and Escape/Enter. Search uses ordinary mouse/touch with the popup
  open. Query/filter preservation, exact result rows, private-sentinel exclusion,
  page containment and page-error assertions pass. Desktop/phone screenshots were
  inspected. No forced click or pre-click dismissal qualifies Search.
- Two corrected controls pass: anonymous Advanced Search receives an actual
  successful type-suggestion response; API checks cover anonymous, signed-in and
  invalid-session public requests, forced flags, private-name/private-owner
  exclusion, supported finish scope, bounded results and invalid kinds. Private,
  wrong-path and unrelated inventory requests without authentication are rejected;
  an invalid session is rejected by the private suggestion route.
- Exact fixture cleanup and complete original Inventory, audit, location, user,
  player and card counts/hashes match the retained pre-test baseline. A timed-out
  test originally skipped cleanup after its page closed; its exact synthetic
  owner/stock was verified and removed. All six original hashes then matched.
  The finalizer now runs database cleanup even if page cleanup fails.
- The earlier combined #908 phone loading/search trigger passed all twelve
  narrowed rows on the cumulative layout candidate without Escape or a forced
  click. The routing candidate retains those application bytes except the listed
  Public route/caller changes; this is not claimed as a new run on that image.

The 20 browser cases passed in a 22-case run whose two added controls failed;
those failures remain failed. Only the two corrected controls were rerun, both
passing. Unrelated leftover synthetic stock from the timed-out control was
present during the original 20-case run; each case used its own unique query,
proved its own cleanup, and the complete original baseline was restored afterward.

## Source and runtime binding

The feature branch starts from main `51f810c3`. Cumulative local review also
includes separately qualified [#909](https://github.com/sefaction/MTG-Archives/pull/909)
at `b62df4f2`; that PR is not included here. Cumulative source
`258ce94c8458e7a633e102789788b72cb6504fbd` builds 1,226 declared inputs with digest
`4b0d7afc20a77db583ad5d551426b93b09ca87173aaaac030951cf1c2da00d8a`.

The image manifest equals the expected cumulative manifest. Quick Search,
Advanced Search, the public route, middleware and private APIs exactly match the
feature source. The only other common application difference is #909's
InventoryBrowser. Cumulative-only infinite-navigation tests and later corrections
to two browser test files are explicitly recorded in the private binding. Tests
run from feature source outside the image; no application bytes changed after
the build. The declared-input manifest is not a whole Docker-context digest or
a reproducible-binary identity.

Compilation, types, static generation and client manifests pass in the bounded
2 GiB/no-extra-swap/one-CPU builder with a 1536 MiB JavaScript heap. Changed-file
lint ran separately; canonical final-head CI remains required before readiness.
There were zero Docker OOM kills. The first routing build was deliberately
stopped to include the second Public caller; its graceful-stop log is preserved.
The successful builder/cache and superseded layout-only web/image were retired.
Current cumulative review and earlier rollback reviews remain available.

## Preserved failures and separate remainder

The unchanged 320px client fails a real-touch negative because a suggestion
intercepts Search. Earlier browser fixtures used an unsupported condition query;
those later assertions failed and are retained. Correcting that fixture to retain
the Language query does not establish enforcement of every Public filter.

Before the routing repair, the public-flagged private URL returned actual HTTP
401 and anonymous settled/keyboard cases received no options. No fake cookie or
authenticated substitute qualified anonymous Public behavior.

The first added API control exposed an existing Public Language-filter gap:
English rows/names still appear for `language=FR`. That failure is independently
recorded as [#913](https://github.com/sefaction/MTG-Archives/issues/913), with
reproduction and acceptance criteria. This routing repair preserves the existing
public query and does not fix Language filtering. Its corrected scope control
tests the supported finish filter. The Advanced control initially targeted an
incorrect button label; the corrected accessible control passes. Other
loader/wrong-working-directory/missing-file attempts are harness errors, not
application passes or unexplained product regressions.

This is author software/browser qualification, not independent review, physical
phone certification, merge, installation or user acceptance. Check PR #912 for
current final-head CI/readiness. Both issues stay open until their individually
approved resolving merge. No merge or production authority is granted.
