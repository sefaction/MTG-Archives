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
## Completed local qualification, October2 02:23 Central

Core PASS764 units/zero skips, typecheck/lint/build/ten manifests. Required real
scanner-installer Docker build PASS. Exact510 running build inputs match
SHA897c72adc8a0866a95d78ec5f7c4faed91c15948fe5227e14ab6e0c29f0e7f84;
image mtg-archives-web:audit-response-lifecycle,
sha256:eb4f58ead946ca2c82a60b1e995e2962ff9cd13f75287d00d5b18a3b4cb01dbd.

Initial complete group FAILED18/19 in7.0minutes: the recovery fixture changed its
status to RUNNING before clicking the failure-only action, allowing valid polling
to remove that button. Keep failure available until search opens, then resume.
Application recovery behavior/timeouts/assertions are unchanged. Failure log and
traces remain private as night-audit-response-fixture-race-failed-*.

Corrected COMPLETE group PASS19/19, zero skips,6.8minutes. Includes all9 Inventory
detail/keyboard/phone/public/actual200%zoom checks, four new audit races, navigation,
recovery, drafts/bulk/quick-finish/corrections, and successive real Windows fixture
helper native-recognition/review/explicit-commit acceptance. Phone screenshot
inspected: Audit stays closed and focus returns to View details.

After cleanup all original hashes match start-of-night:10280 Inventory rows,
12482 copies,81 saved reviews,907 photo IDs/digests; owned helper users/agents0.
One catalog-worker restart during the initial group is tracked separately as579;
OOMKilled=false, successful jobs resumed. No additional restart in the corrected
group. The actual stop cause is not established. Production565 and native100
throughput failure remain independent and open. No merge/deployment/hardware run.
