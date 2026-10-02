# Inventory audit response lifetime

Issue555's retained failure screenshot shows an Audit Trail dialog reopened after
its close/count0 assertion passed. The loader sets auditRow before awaiting fetch,
then unconditionally sets it again after response. Closing previously cleared only
UI state; a late response could reopen the modal and steal keyboard focus, or an
older request could replace a newer result/error.

Deterministic held-response browser cases reproduced the unchanged application:
both1366px and390px CLOSED the dialog, returned focus to View details, then saw
it reopen after releasing the response. Both baseline tests FAILED, with separate
private traces/videos/log. The original intermittent failure and later isolated
pass remain retained too; they are not reclassified as universal passes.

The fix gives each audit loader a generation. Opening another request, closing by
Escape/Close/backdrop, or unmounting retires the previous generation. Only the
current request may update rows, errors or loading state. Ownership/endpoint/data,
modal focus/scroll rules and all Inventory writes remain unchanged.

Two close-before-response regressions and two stale-error/new-request cases
exercise actual authorized fixture responses. Existing owned edit/audit, public
read-only, desktop/phone and actual200%zoom acceptance are included in the final
affected group. Required core/build/current-source and browser results are recorded
when complete. This change stays local/unmerged pending individual approval.