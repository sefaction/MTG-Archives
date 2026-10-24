# Inventory addition across a disposable database process loss

Fixes #961; related to #310/#302. This is one named software-recovery boundary,
not broad release acceptance. No production or physical operation.

## Result and product change

The actual application passes desktop1366 and phone320 recovery after two owned
PostgreSQL process interruptions per case. Uncommitted stock/audit/receipt/member
writes roll back; a completed addition survives a second interruption while its
HTTP reply is held. Explicit retry keeps the same frozen request across503→200
and has no duplicate effects. The next ordinary addition succeeds. Three copies,
three receipts/members/audits and one pending card remain, with saved reviews,
processing jobs, original bytes, owner/foreign privacy and web lifetime conserved.
Both current85-table baselines restore exactly. All three browser tests pass,
including the separate POST-history contract, in2.0minutes (53.5s/52.3s/1.4s).

Two product changes support recovery:

- Page and global/root-layout boundaries share a self-contained error screen.
  It starts an explicit same-origin GET for the same path/query and tells the
  operator to check the latest outcome before repeating an action. Clearing an
  absent/empty/named fragment cannot repeat a document POST or merely navigate
  within the failed document. Raw errors, SQL, database details and credentials
  are not passed into the screen.
- Only the commit route classifies a closed Prisma connection (P1017) as a
  sanitized503 transport failure. The existing UI retains its frozen request
  for explicit retry. A409 semantic refusal previously cleared that request.
  Authorization/semantic403/409 handling and other routes/upload retry hints
  are unchanged.

There is no automatic Inventory replay, shared-client disconnect, recovery
transaction, pool/lifetime setting, schema, authentication or write-policy change.

## Qualified source and evidence

| Binding | Actual local qualification |
| --- | --- |
| Application and harness source | caf31917d7b3848e38074f34b085e6fe195ab0b3 |
| Application image | a7c3c5392f7632181e1d41f712e24b1a26d34852086e538f0996be2e06e4b762 |
| Git source archive SHA256 | c69116ec3a5cb058104d77badf3e5b683825e05a51234a0f87864a2dc7be6117 |
| Build manifest / inputs | 5b66524b34b6e374f1cd96d7b060a021a326af2d9b8099385b0ce87ea2dd8bf0 /1297 |
| Browser harness archive / files | bc4548e0280889f280ac4260f0947765a19d680c215454f63ea745ec26383f00 /9 |

The archive is byte-identical to git archive caf319; all1297 manifest entries match
that archive and the loaded web filesystem. The nine executed harness inputs match
its Git archive after CRLF→LF normalization only. Later documentation updates do
not change those application/harness/dependency/schema inputs; do not describe the
local image as having a later full source tree. Required final-head hosted checks
and independent review are recorded on the PR separately.

Seventeen focused ownership/navigation/commit-error controls, exact-source local
generation/types/build/client manifests pass. All ten caf checks pass in Verify
40074049008 and pool40074048958: actual Core1666unit passes/one existing Windows
helper skip, types/build/client and27issue-guideline checks; the pool report is
MEASURED with no failures and cleanuptrue. Hosted9f58af98(base9b3+headcaf) has the
exact feature tree673d222f. These results do not substitute for final-head CI.

The actual1366 recovery uses one explicit GET200. Phone320 uses GET500 then GET200;
the error control remains available. Both original commit retries receive503 then
200 with the exact same body/key and unchanged durable ledger after each attempt.
Screenshots of the recovery screen and retry controls at both widths were inspected.
The browser POST-history server records POST→GET for all three fragment histories.
Its private initial-action negative records POST→POST and fails the same assertion.
That negative is the first draft action, not an old production recovery control.

Private compact evidence remains under .local-data/database-loss-310-20261024:
source/build/image/harness bindings, final-browser-summary, all-browser-conservation,
per-case barrier/lifecycle/ledger/GET/retry/settings/original records and screenshots.
Seven full browser85-table pairs match, including all five failed attempts. Two
additional native diagnostic85-table pairs match independently. Do not publish
private payloads, credentials or images from unrelated installations.

## Declared scenario and reproduction

Use newly migrated disposable PostgreSQL and the actual application with generated
JPEG uploads, three explicit manual reviews and one pending card. No recognition
worker is present. Run one Chromium worker at1366 and320 with max-failures1.

1. A test-only AFTER-member-insert trigger checks the in-transaction stock,
   audit, receipt and member, then waits on the exact owned advisory blocker.
   Observe the actual web INSERT waiting on that PID before killing only the
   fixture PostgreSQL container. Require137/no OOM and terminal blocker/helper.
2. Consume the failed commit response, then navigate the existing batch while
   that database remains down. Require the actual root error boundary. Restore
   the same container/volume, inspect real PostgreSQL automatic crash recovery
   with fsync/full_page_writes/synchronous_commit stillon, and verify full rollback.
3. Use the visible recovery button. Each click must navigate with GET to the
   same path/query. Preview/add explicitly, then verify effect-free exact replay.
4. Forward the second real commit and hold its successful HTTP reply. Check the
   durable two-copy ledger, interrupt/recover the same PostgreSQL again, and
   require identical stock/audit/receipt/member rows afterward. Abort the held
   reply; explicitly retry its original frozen request through transient503.
5. Add the third reviewed card normally. Verify the one pending card, original
   metadata/bytes, all saved reviews/jobs, owner200/foreign403 and unchanged web
   lifetime. Remove only owned fixtures; compare all85 full-row baselines.

The case remains bounded at180seconds, ordinary locator waits at15seconds and at
most five explicit GET/retry clicks five seconds apart. No fixture query warms the
application process's pool. Stop on the first unresolved failure and retain it.
If boundary navigation fails before PostgreSQL restart, leave the stopped graph
and records intact; the owner must recover the exact fixture before cleanup/release.

Every fault/restart/removal checks immutable container/image/run/nonce identity,
the sole expected data volume, exact internal network, references, no published
port/privilege and valid running/terminal state. SQL barriers belong only to the
new empty fixture and are removed before ordinary recovery/retry. A name, elapsed
time, expired claim or later passing test never authorizes another owner's target.

| Variable | Required value |
| --- | --- |
| MTG_DATABASE_LOSS_TEST / MTG_REVIEW_ACCEPTANCE_TEST | 1 /1 |
| PLAYWRIGHT_BASE_URL | http://127.0.0.1:3000 inside the private fixture namespace |
| MTG_INVENTORY_TEST_CONTAINER | Full immutable owned web ID |
| MTG_INVENTORY_TEST_DATABASE | Exact new review database |
| MTG_DATABASE_LOSS_POSTGRES / IMAGE | Full owned PostgreSQL ID / exact image SHA256 |
| MTG_DATABASE_LOSS_RUN / NONCE | acquisition-database-loss-310 owner / matching32hex |
| MTG_DATABASE_LOSS_NETWORK / VOLUME | Full internal network ID / sole owned data volume |

The controller needs locked Playwright/Chromium, Sharp and Docker CLI/socket. The
web uses private uploads; no browser/helper/SQL client or active transaction may
remain at retirement. Require removed barriers, restored fingerprints, empty
uploads and sole exact volume/network references before retiring owned resources.
The current qualified image and compact source/failure evidence remain for review.

## Preserved failures and rejected hypotheses

The first observation-SQL typo failed before an interruption. The corrected old
application then rolled back/recovered PostgreSQL but showed a generic root
exception without recovery controls (P1017 in authentication). Its card locator
reached the original180-second deadline. Both85-table pairs restored.

The corrected daf image had two post-recovery navigation failures: one fresh GET,
then five rapid GETs still returned500. A third run recovered its first addition
and replay, then preserved a second durable addition across a crash but lost the
original retry after a409. All three failed workflows restored85 tables. Phone
and the next addition were not reached; do not count them as passes. The final
scenario deliberately renders the boundary during the outage rather than requiring
the recovered driver to fail nondeterministically afterward.

A locked Prisma6.19.3/enginec299 native diagnostic reproduces repeated cold-prepare
P1017 until a previously cached path retires the closed channel. Independent source
review corrected an incomplete lower-builder interpretation: the effective query
engine already enables checkout health checks at15-second intervals. Paired
30-second-lifetime and explicit0 controls both fail three times then recover on
attempt4 after about15seconds. Each preserves a healthy same-client writer beyond
35seconds, with exactly one insert and all85 table fingerprints restored. This
does not establish indefinite failure, a need for new pool policy or a cause for
#846/#859. The proposed lifetime/helper/tests were withdrawn completely.

An empty health-transaction proposal was also rejected: its options do not bound
every BEGIN/rollback path. It is absent from product source. Retained setup failures
include the diagnostic module loader,84-vs85 migration-table count and encoded-space
URL assertion; each is separate from product qualification. Prepared zero-control
marker mistakes were caught before allocation. An independent named pool run also
refused the historical source equality before allocations; moving its allowed
pre-existing builder inventory read earlier fixes the misleading cleanup comparison
without removing the original source, route, observation or owned cleanup checks.

## Other release boundaries

Existing merged P7 transaction/writer controls, capture/file-fault and consistent
archive/restore evidence remain separate. PR960 covers actual browser-process loss
at3d0eb9d5 while PostgreSQL/web stay alive; this case interrupts PostgreSQL while
browser/web stay alive. Neither substitutes for the other.

Controlled SIGKILL preserves storage. This is not OS/power loss, corrupted or lost
storage, every failure point, natural-fault acceptance, scanner/native/optical
accuracy, installation deployment, production or user acceptance. #310/#302 and the
unresolved #808/#844 incident causes remain open. Close #961 only after its approved
resolving merge; individual approval and an explicit merge request are still required.