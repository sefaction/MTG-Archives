# Resumable work checkpoint

Updated 2026-09-19. GitHub remains authoritative for live issue/PR status.

## Active batch

- Branch: feature/inventory-move-experience, based on feature/vault-inventory-pilot.
- Issue: #218, inventory move polish and Explorer-style selection.
- Dependencies: open PR #210 (setup) and #217 (vault pilot). Neither is approved to merge.
- Implemented: focused move dialog, integrated keyboard-searchable destination list, section occupancy cards, dynamic fill/all/85/custom quantity modes, review summary, tucked-away deletion, Ctrl/Meta and Shift selection in displayed order.
- Binder retains plain-click details; modifier-click and checkboxes select. Table non-control row click selects; links/buttons preserve their own behavior.
- No outstanding product question for this batch.

## Verification / next safe step

- Typecheck and 509 automated tests passed before browser verification.
- Docker rebuild started; verify actual completion and host HTTP before testing.
- Expanded opt-in tests in tests/ui/vault-pilot.spec.ts need execution against the rebuilt Docker app. Inspect desktop/phone screenshots; fix any failures, then run the full suite sequentially.
- Open a dedicated PR stacked on #217 after verification; record its exact local image/commit in LOCAL_REVIEW_BUILD.md.
- Never merge any PR without individual user approval.

## Resumption rules

Read AGENTS.md, the Foundry hub/workflow/feature notes, and this checkpoint. Inspect git status, open PRs/issues, and container/process state. Preserve unrelated changes. An interrupted command is not evidence of success; confirm its result before repeating operations.

If an answer is required, record the specific question and ask in the active project chat. Continue independent, authorized work from the queue while awaiting input. Recurring execution is not configured; this file does not create an automatic runner.
