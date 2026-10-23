# Native scanner fixture cleanup (#932)

The remaining original native-helper verifier under #692 called its first
correction sweep outside protected teardown. An injected failure at that call
skipped owned helper termination, the legacy source/user/spool cleanup and the
final correction sweep. It could also replace an earlier workflow failure.
This is test infrastructure, not a diagnosed production scanner incident.

The repair independently attempts the existing early sweep, unchanged legacy
teardown and final sweep. It retains the primary failure and every cleanup cause
in order, including falsy thrown values. Exact owner validation precedes effects.
The original live-helper refusal remains: a helper that is still running keeps
its spool and legacy data for recovery. The final feedback sweep is still tried.

The legacy teardown remains one existing action. A persistent failure inside it
can leave that action's own residue; this change does not claim every SQL/file
statement succeeds after an internal failure. It repairs the outer bypass and
cause handling without weakening that live-process safety boundary.

## Evidence

- An actual old-source AST block with an injected first-call rejection executes
  only the early sweep. No helper stop, legacy teardown or final sweep occurs.
- Ten focused controls execute the actual repaired catch/finally: failures at
  each of the three actions, healthy order, ordered primary/cleanup causes,
  original cause identity, invalid-owner refusal, falsy workflow causes and live
  helper protection. The complete legacy block remains byte exact after newline
  normalization. Focused types have zero diagnostics; lint/whitespace pass.
- An AST comparison preserves the complete original main workflow, all 71
  `expect` expressions, opt-in and all action/case/poll deadlines. No original
  assertion, input, SQL/file expression or successful helper behavior is changed.
- The isolated real PostgreSQL/filesystem probe executes old and fixed blocks.
  The old injected failure leaves Player, User, location, correction account and
  private marker intact, with a real owned Node helper stand-in still running
  and its spool retained. Exact-owner recovery executes the repaired block.
  Under the same injected failure, the candidate stops its Node child, logs,
  passes the forget adapter, clears legacy rows and private directories, and
  preserves the exact primary plus injected cause. No Windows scanner helper
  command is executed by this probe.
- A populated independent owner's complete four model rows and actual private
  marker hash remain identical across both cases. After exact cleanup, all 85
  public-table count/full-row hashes match the original migrated baseline.
  The source main's migrations are applied to this fresh database, including
  migration-only constraints. The first seed used an invalid display key and
  correctly failed its database constraint; its three partial rows were exactly
  recovered and all 85 original fingerprints restored before the passing probe.

The separately owned PostgreSQL/Node fixture has 384/320 MiB limits, one CPU
each and no extra swap, admitted with measured host/VM/storage headroom. It uses
the existing image only for its Node/Prisma runtime; current migration files and
actual candidate cleanup SQL execute in the isolated database. There is no
new entire application-image or native-engine qualification. Private baseline,
actual-source controls, complete records, failure/recovery and resource receipts
are in `.local-data/scanner-native-cleanup-20261023/`.

Retirement preserves a separate harness shutdown result: the disposable idle
Node keepalive exceeded its declared 20-second stop, with Docker recording
SIGTERM then SIGKILL and exit 137, OOM false. Its completed probe exec exited 0;
memory max/OOM events stayed 0. PostgreSQL exited 0, repeated fixture/client
counts were zero, and the exact containers, sole volume and network were retired.
The stopped keepalive's original timeout/error/events remain evidence; no clean
exit is claimed for it and no historical application failure cause is inferred.

## Limits and delivery

The original full Windows helper/native recognition/browser workflow is **NOT
RUN in this batch**. It retains its original opt-in, inputs, assertions and
deadlines. The passing probe qualifies this cleanup boundary using a real Node
child and an explicit forget adapter; it is not actual Windows helper behavior,
physical feeding, native recognition, desktop/phone acceptance, sustained
throughput or historical failure diagnosis. Earlier native evidence keeps its
original revision/environment limits. No scanner motor, production, retention
policy or unrelated review resource changes occur.

Required exact-head CI and independent review are recorded on the PR before
readiness. #932 closes only after its individually approved resolving merge;
broader #692/#310 and unavailable optical/independent-accuracy/scale evidence stay
open with their existing criteria and history.
