# Inventory addition across a disposable database process loss

Fixes #961; related to #310 and #302. This is one named software-recovery boundary from the
release matrix, not broad release acceptance. No production or physical operation.

## Existing evidence and missing scenario

| Scenario | Existing evidence | Remaining boundary |
| --- | --- | --- |
| Stock/audit/receipt/member rollback and replay | Merged P7 PostgreSQL transaction/writer checks | An actual PostgreSQL process loss during staged writes |
| Photo publication/file faults and interrupted writers | Merged #934/#942/#949/#957 and correction recovery | Do not substitute file/child failures for a postmaster crash |
| Capture-consistent archive/restore | Existing acquisition capture/archive verifier | Restore success does not prove a live transaction survives interruption |
| Browser process loss after server success | PR #960, separately reviewed at3d0eb9d5 | Database/web remain alive in that case |
| Uncommitted addition across PostgreSQL SIGKILL | New isolated scenario below | Pending qualification |
| Durable addition across PostgreSQL SIGKILL with HTTP reply held | New isolated scenario below | Pending qualification |

## Declared scenario

Use the actual application, newly migrated disposable PostgreSQL and generated
uploads. Save three explicit manual reviews and one pending card; no recognition
worker is present. Run at desktop1366 and phone320.

1. At a test-only AFTER-member-insert advisory barrier, observe the actual web
   transaction waiting on the exact known blocker. Stock/audit/receipt/member
   statements have run but are uncommitted. Kill only this fixture's exact
   PostgreSQL container; require exit137/no OOM, restart its same data volume and
   inspect real PostgreSQL crash recovery. Verify complete relational rollback,
   unchanged source/reviews and no implicit Inventory. Complete the next explicit
   UI preview/addition and verify effect-free replay.
2. Forward the next real UI commit and hold its successful HTTP reply. Verify the
   durable receipt and ledger, kill/restart only the same PostgreSQL instance,
   then release the held response as a network failure. Retry the original UI
   addition using the same frozen request; no additional stock or ledger entries.
3. Perform the next ordinary explicit UI addition, preserving one pending card,
   all original photo bytes and saved reviews/jobs. Verify owner/foreign privacy,
   unchanged web lifetime and all85 public-table full-row baseline fingerprints
   after cleanup. Stop at the first unresolved failure and retain its evidence.

Every fault/restart/removal requires full container/image/run/nonce identity,
the sole expected named data volume, exact private network, no published port or
privilege and an observed valid running/terminal state. A name, timeout or old
claim alone never authorizes interruption. The SQL barrier belongs only to this
empty isolated fixture and is removed before ordinary recovery/retry.

This controlled process failure preserves storage. It is not operating-system
power loss, corrupted/lost storage, every database failure point, natural-fault
acceptance, native/optical accuracy, installation deployment or user acceptance.
Required final-head CI, actual source/runtime binding, layout results, failed
attempts, independent review and exact-owned retirement must be recorded before
review readiness. Existing successful workload gates are not rerun or redefined.

## Reproduced recovery-UI defect

The first observation-SQL typo stopped before a declared interruption; its
baseline85-table pair restored. After correcting that typo, the actual old
application completed PostgreSQL recovery and relational rollback but the next
scan-page navigation threw P1017 in root-layout authentication. The default
exception page had no recovery control. The card locator reached the unchanged
180-second case deadline; cleanup still restored all85 table fingerprints.

The repair adds page and global/root-layout error boundaries sharing a small
self-contained recovery screen. The operator explicitly starts a fresh same-origin
GET for the same path/query and checks the latest outcome before repeating an
action. Fragment removal uses history replacement before document navigation, so
neither a document POST replay nor a fragment-only navigation is used. An actual
browser contract covers no fragment, an empty fragment and a named fragment. Raw error details are
never passed into its UI. Authentication, database pools, transactions and write
retry policy are unchanged. This does not diagnose the separate #808/#844 reports.

The test now bounds ordinary locator waits at15seconds instead of exhausting the
whole180-second scenario on a missing card. No recovery assertion/deadline is
weakened; the old application failure remains evidence. Corrected product build
and the same declared desktop/phone cases are pending.
