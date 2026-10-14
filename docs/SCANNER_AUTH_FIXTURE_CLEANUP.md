# Scanner authorization fixture cleanup

Issue #797 is a narrow child of #692/#310. The actual main c076cfa native HTTP authorization verifier stops at its first correction sweep after a controlled error; legacy scanner/source/user/private-file teardown and final feedback sweep are skipped. The repair independently attempts all three existing actions and preserves primary plus cleanup causes, including falsy thrown values. Exact-owner validation precedes all database actions. All 23 original assertions, complete workflow, SQL/file actions and deadlines remain exact.

Qualification so far: actual baseline negative control, eight actual-source node:test controls and types pass. Initial transformation added one newline to the legacy block, failed strict equality before fixture mutation, and was corrected by retaining the exact original AST block. No original acceptance assertion was weakened.

Pending: real disposable PostgreSQL baseline/fixed/neighbor/recovery probe, complete unchanged protocol browser case in current cumulative local review, runtime/source/catalogue/original/upload conservation and exact-head CI. Keep draft until complete; the separate reviewer owns readiness, individual approval, merge and issue closure.

No application/native changes or image rebuild are required. This software protocol case uses no helper or motor and does not qualify physical scanning, native recognition accuracy, throughput, production or older worker-stop causes. Historical conservation failures remain unchanged. Private evidence and exact owner journals stay in ignored .local-data/scanner-auth-qualification.
