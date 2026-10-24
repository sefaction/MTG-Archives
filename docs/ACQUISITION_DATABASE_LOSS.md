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

## Ownership and reproduction

The controller needs locked Playwright/Chromium, Sharp, Docker CLI and a Docker
socket. Its browser and own ephemeral POST-contract HTTP listener share only
loopback with the fixture web; no port is published. The web uses a private
uploads root and the database uses one freshly created named volume. Both carry
matching run/nonce/role labels; the network is internal and the volume/network
labels and references are rechecked at each declared interruption and restart.

| Variable | Required value |
| --- | --- |
| `MTG_DATABASE_LOSS_TEST` | `1` |
| `MTG_REVIEW_ACCEPTANCE_TEST` | `1` |
| `PLAYWRIGHT_BASE_URL` | `http://127.0.0.1:3000` inside the fixture namespace |
| `MTG_INVENTORY_TEST_CONTAINER` | Full immutable owned web ID |
| `MTG_INVENTORY_TEST_DATABASE` | Exact newly created `review\w+` database |
| `MTG_DATABASE_LOSS_POSTGRES` | Full immutable owned PostgreSQL ID |
| `MTG_DATABASE_LOSS_IMAGE` | Exact PostgreSQL image SHA256 |
| `MTG_DATABASE_LOSS_RUN` | `acquisition-database-loss-310-...` owner run |
| `MTG_DATABASE_LOSS_NONCE` | Matching32hex label on web/database/network/volume |
| `MTG_DATABASE_LOSS_NETWORK` | Full immutable internal network ID |
| `MTG_DATABASE_LOSS_VOLUME` | Sole `mtg-database-loss-data-...` named volume |

Run the two named database-loss and page-load-recovery specs with one Chromium
worker and `--max-failures=1`. Save source/image/archive and lifecycle/barrier/
ledger fingerprints. After the test, require browser/helper/request termination,
zero transactions, removal of its test-only barrier, exact85-table baselines and
empty uploads before retiring only the owned fixture. A failed or uncertain
termination preserves recovery records. This is not a production command.

## Draft review correction

Independent source review5637104548 found that the initial draft's history reload
could repeat a document POST. Corrected source uses an explicit same-origin GET
replacement after clearing even an empty fragment without navigation. Four focused
navigation/ownership controls and strict harness types pass. A real Chromium
form-POST history contract passes all three absent/empty/named-fragment cases
(17.9seconds), with each server trace exactly POST then GET. The private old-action
control repeats POST then POST and fails the unchanged recovery assertion. This
negative is the initial draft action, not a claim about an old production control
that did not yet exist.

The full database scenario requires an observed recovery-screen reload and saves
its screenshot; it cannot pass by silently skipping that branch. Corrected exact
product build, complete desktop/phone matrix, final-head CI and independent final
readiness remain pending. The POST contract uses the actual helper with a private
HTTP fixture; it does not itself qualify the full application or database case.
## Subsequent corrected-image failures (preserved)

Exact source daf94e73 compiled successfully into image bd39e8f7 (1297 inputs,
manifest afebcdc9, archive 7dc46564). Its first1366 run rolled back correctly and
showed the recovery control, but one explicit GET still received P1017. A second
bounded run made five rapid separate GETs, all500. Both restored all85 tables.
Neither reached the durable window or phone layout. Their traces do not prove
whether the pool, query preparation or a different layer owns the failure.

A subsequent run allowed five explicitly clicked GETs five seconds apart. It did
not show the page fallback in that run: ordinary first addition and exact replay
passed. The second addition's stock/audit/receipt/member ledger remained identical
across a second real PostgreSQL SIGKILL/recovery. However the browser's original
retry then received P1017 as generic HTTP409. The commit UI treats409 as a semantic
refusal and clears its frozen request, losing the original retry control. All85
baseline tables restored again. This remains a failed workflow, not a matrix pass;
the phone case and next ordinary addition were not reached.

The scoped correction classifies P1017 as503 only in the commit route. The browser
already preserves its frozen request for such transport failures; no automatic
commit replay or shared-client disconnect is introduced. Other routes, upload retry
hints, authorization and semantic403/409 handling remain unchanged. Focused
classification controls, a new compiled image and the original desktop/phone
recovery gates are pending. Five explicit GET attempts remain bounded; no dead
connection cause or complete database-recovery repair is claimed from this change.
## Historical lifetime proposal (withdrawn)

A separate native-client diagnostic on locked Prisma6.19.3/enginec2990dca
reproduces the cold-prepare failure. After a controlled PostgreSQL interruption,
a new SELECT fails repeatedly with P1017; executing a previously prepared SELECT
fails once, and the new SELECT then succeeds. The engine source obtains prepared
statements before its connection-health-marking I/O wrapper. This supports that
bounded mechanism in this diagnostic; it is not a claim about every historical
incident or a passing application workflow.

An empty health-transaction proposal is rejected and remains private only:
maxWait/timeout do not bound every BEGIN/rollback path. No such health action,
shared-client disconnect or automatic operation replay is included.

The rejected8a/243 proposal defaulted the supported absolute max_connection_lifetime to30seconds
when PostgreSQL has no explicit lifetime setting. Explicit installation policy,
including0, remains byte-preserved. Connection limits, socket/pool timeouts and
other URL settings are preserved. The native pool retires expired idle leases at
checkout rather than terminating an active query or transaction. This is a finite
availability mitigation for the reproduced reuse problem, not an upstream engine
patch or a cause/repair claim for #846/#859.

The actual30-setting diagnostic terminated only its exact owned idle backend while
a healthy transaction on the same two-connection client held a single insert open.
Cold SELECT failed three times and then succeeded on attempt4, about15seconds after
the first refusal. The healthy writer retained its PID through35,013milliseconds
and committed exactly one insert. All85 public-table full-row fingerprints restored;
the private diagnostic schema was removed. Observed recovery timing is recorded,
not asserted as an exact lease-age boundary or universal deadline. An initial
fingerprint count guard excluded the migration table (84); it stopped before writes
and was corrected to the same85-table scope.

The application regression retains its180-second case deadline. Recovery uses at
most five explicit GET clicks and five original frozen-request retry clicks,
spaced five seconds apart, recording each method/status and preserving the durable
ledger after every attempt. It requires an actually observed page recovery screen;
no fixture query warms the application pool. Full new-source build, desktop/phone
results, final-head CI and independent review remain pending.
## Current correction and unchanged policy

Independent review traced the effective query-engine caller, not only the lower
pool builder: lockedc299 PostgreSQL enables test_on_check_out and a15-second health
check interval. The earlier~16-second read recovery cannot be attributed to the
proposed30-second lifetime. The absolute-lifetime change/helper/tests are withdrawn;
lib/prisma.ts is restored exactly to its original baseline. The paired0-setting
control remains a bounded diagnostic, not a new application policy. Existing
cached-prepare failures and all earlier experiments remain preserved; no indefinite
failure or historical #846/#859 cause is established.

Current product changes are the explicit POST-safe recovery screen and commit-route
P1017→503, preserving the frozen request for operator retry. No pool settings,
authentication, active transaction behavior, automatic retry or client lifetime
change remains. The actual current-source local build and full matrix are pending;
the compiled243 lifetime proposal remains separately bound evidence/cache only.

The browser now renders the actual root boundary by navigating while the first
owned PostgreSQL interruption is still present, after observing the interrupted
commit reply. Then it restarts the same database and uses the visible control.
This makes boundary coverage deterministic without requiring the recovered driver
to fail on every later read. It retains observed fallback/reload, exact rollback,
all durable-before/after ledgers, original frozen-request retries, next ordinary
addition, privacy/originals/reviews and85-table cleanup checks at both widths.
There is no private fixture query that warms the application pool. Each explicit
GET/retry is recorded, at most five clicks spaced five seconds, within the unchanged
180-second case bound. Prior post-recovery-only navigation failures remain evidence
of their original scenarios and are not rewritten as passes.

The named pool CI keeps its original historical unchanged-Prisma-source equality
and all canonical image/route/process/connection/cleanup controls. Only the allowed
pre-existing builder inventory/context read moves before source checks, so an early
source refusal compares with the actual starting inventory. The intermediate57
current-source measurement rewrite is withdrawn. No unrelated builder is removed.