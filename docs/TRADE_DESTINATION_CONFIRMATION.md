# Explicit physical trade destinations (#834)

Physical confirmation now starts with a blank, required destination selector.
The placeholder remains selected with zero, one or several eligible locations;
neither the first location nor an older saved destination is preselected.
An explicit valid selection is sent through the existing confirmation action.

Both participant branches now always validate that submitted destination before
writing a confirmation timestamp, trade event or notification. Missing values
receive a selection error. Stale, inactive, other-owner, system-managed and
non-normal locations retain the existing rejection. Prior stored destinations
cannot substitute for a missing submission.

Authorization, status and repeat-confirmation guards, the separately reasoned
admin force-complete path, and the downstream transfer/provenance transaction
are unchanged. This patch changes no capacity policy, database schema or service
configuration. Historical/admin completion fallback is preserved.

## Focused qualification on STMLT26

Base: `8ad7cd949b034226a10a2b21f2a3cdbd9abdd155`.
Branch: `codex/issue-834-trade-destination` in the issue-specific worktree.

- `tsx --test tests/trade*.test.ts`: 75 passes, including 25 new tests executing
  the actual confirmation action and location validator with isolated adapters.
  Both participants reject missing/blank/invalid destinations before writes,
  including when the partner already confirmed. Explicit choices, event behavior,
  repeat/status/participant guards and the reasoned admin override are checked.
- `playwright test tests/ui/trade-destination-select.spec.ts --reporter=list`:
  six passes in 11.9 seconds. Actual React server-rendered selector markup is
  exercised in isolated forms at 1366px and 320px with zero, one and two locations.
  Native validation blocks blank/cleared submissions, and explicit choices
  appear in submitted FormData.
- `tsc --noEmit --incremental false`: passes with locked dependencies installed
  in the owned worktree. No shared dependency tree was changed.
- Independent read-only review found no blocking product-code finding.
  `git diff --check` passes.

The existing real two-party lifecycle browser test now additionally expects both
selectors to start blank. It was not run against the shared application/database.
The isolated action tests spy completion; they do not prove PostgreSQL rollback,
concurrency or full-page layout. The isolated form has no application CSS, so its
phone viewport check establishes form behavior, not full-page visual acceptance.

## Retained setup failures and remaining review

The initial existing UI source-contract test expected the inline selector; it was
updated for the extracted component and passes. Initial isolated Chromium runs
failed because Playwright applied its JSX mounting transform, then because its
disabled-option matcher disagreed with the actual disabled DOM attribute. A
plain React rendering subprocess and direct disabled-attribute check correct the
harness. One run was interrupted during dependency replacement and is not passing
evidence. Initial shared-dependency typechecking lacked the new stream-json
dependency. Offline installation resolves that mismatch. Prisma's ordinary binary
download is blocked by network restrictions; cached local binaries are reused
only for generation in the owned worktree.

The shared issue-worker lock was held during this work and was not acquired,
modified or released. No shared service, inventory, database, credential, resource
limit or production state was changed. No merge or deployment was performed.

All three required CI checks subsequently passed on implementation head
`6e8ffe4d8d1720a4472411279a34441a5671ed65`, draft PR #874. Combined source-only
qualification with #873 at `29c9397a4be3eb7f97f07fa9cd98ab17e1418d4b` passed 100 Node
tests, nine isolated browser cases and typechecking. There is no product-file
overlap; both checkpoint entries are preserved.

## Isolated full-application follow-up

The parent clarified that the restriction against disturbing shared services
permits properly coordinated isolated test resources. The #855 worker owns the
single combined build, disposable web/PostgreSQL fixture and exact-owned cleanup;
the runtime owner's resource window and lock protocol are still required before
starting it. No duplicate fixture or shared loading is needed for this route.

The trade lifecycle test accepts `MTG_ISOLATED_FIXTURE_MANIFEST` alongside its
existing `MTG_LOCAL_PILOT_TEST=1` opt-in. `PLAYWRIGHT_BASE_URL` must equal the
manifest's distinct loopback web URL. The manifest contains `runId`, `project`,
`baseURL`, `networkName`, `web: {id, name}` and
`database: {id, name, host, databaseName}`. No credentials belong in the manifest.
Both containers and the private network carry
`mtg-isolated-qualification=<runId>`; both containers also carry the exact
`com.docker.compose.project` label. The common fixture database uses the
`acquisition_filter_*` namespace for #855's verifier.

Before any fixture query, the shared test helper verifies a local Docker engine,
exact running container IDs/names, ownership/project labels, the loopback port,
an exclusively owned two-container network, no host bind mounts or unowned
volumes, and the web connection's owned database host/name. Later database calls
use the immutable web ID rather than a reusable container name. Thirty-three
target-guard tests and the 75 trade tests pass; current-schema typechecking passes.
Independent review found that the initial pipe-prefix guard accepted remote UNC
hosts; only local dot/localhost pipes and local Unix socket paths are now accepted.
The guard also verifies an internal local bridge network. Those review findings
and their initial failing scope are retained rather than described as runtime
qualification.

The prepared lifecycle test covers one eligible destination for the phone user,
two for the desktop user, both blank states and native missing-value validation.
In isolated mode it additionally submits missing, stale, inactive and other-owner
destinations through the real browser action for both participants and compares
complete trade/event/audit/inventory snapshots before and after each rejection.
Explicit valid choices must still complete the existing provenance/conservation
checks. Phone/desktop screenshots are retained for visual review. These new
full-application assertions remain unexecuted until the coordinated fixture is
available; preparation is not passing runtime evidence.

Keep #874 draft pending actual full-application qualification and independent
readiness. Each PR still requires Brian's individual approval before merge.
