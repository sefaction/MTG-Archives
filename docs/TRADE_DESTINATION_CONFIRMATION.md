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

Next: complete the normal exact-head CI and independent readiness review. A later
coordinated local review may load the cumulative source and run the existing
two-party lifecycle test and full-page desktop/phone review under the shared test
lock. That requires the runtime owner's coordination and is outside this worker's
instruction to leave shared services unchanged. Each PR still requires Brian's
individual approval before merge.
