# Resumable work checkpoint

Updated 2026-09-19. GitHub remains authoritative for live issue/PR status.

## Active batch

- Branch: feature/inventory-move-experience, based on feature/vault-inventory-pilot.
- Issue: #218, inventory move polish and Explorer-style selection.
- PR: #219, verified for local review and stacked on #217.
- Dependencies: open PR #210 (setup) and #217 (vault pilot). Neither is approved to merge.
- Implemented: focused move dialog, integrated keyboard-searchable destination list, section occupancy cards, dynamic fill/all/85/custom quantity modes, review summary, tucked-away deletion, Ctrl/Meta and Shift selection in displayed order.
- Card names and Binder cards retain plain-click details; modifier-click and checkboxes select. Table non-control row click selects; unrelated links/buttons preserve their own behavior.
- No outstanding product question for this batch.

## Verification / next safe step

- Typecheck, 510 automated tests, and host/Docker production builds have passed during verification.
- Final browser suite at application/test revision 4801f78: 25 passed, 0 failed, 2 pre-existing fixture skips. Desktop/phone screenshots inspected; temporary fixture counts are zero. See LOCAL_REVIEW_BUILD.md for exact image and coverage.
- Earlier full verify had an intermittent color-filter navigation timeout; the unchanged test passed on the final full browser rerun. Issue #220 remains open for diagnosis, not claimed fixed.
- The next independent audit candidates are #220 (filter navigation) and #215 (large-tree navigation/editors). Read relevant Foundry notes and live GitHub status before starting a new batch.
- Preserve the cumulative Docker review build and keep PRs reviewable while continuing authorized work.
- Never merge any PR without individual user approval.

## Resumption rules

Read AGENTS.md, the Foundry hub/workflow/feature notes, and this checkpoint. Inspect git status, open PRs/issues, and container/process state. Preserve unrelated changes. An interrupted command is not evidence of success; confirm its result before repeating operations.

If an answer is required, record the specific question and ask in the active project chat. Continue independent, authorized work from the queue while awaiting input. Recurring execution is not configured; this file does not create an automatic runner.
