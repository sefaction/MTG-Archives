# Inventory addition across an owned browser process loss

Related to release acceptance [#310](https://github.com/sefaction/MTG-Archives/issues/310)
and roadmap #302. The existing `acquisition-commit-steps.ts` drops a successful
reply and retries while the browser remains alive. It does not prove what a new
browser process observes after the original process is gone.

## Declared boundary

The opt-in `acquisition-browser-loss.spec.ts` runs at desktop1366 and phone320:

1. Create an isolated synthetic owner, foreign owner, printing and three actual
   image uploads. Save two explicit manual reviews and one pending decision.
   Recognition workers are absent; this is not an optical recognition test.
2. Checkpoint only the fixture's authentication profile with a graceful setup
   close. Reopen that profile and perform an actual UI Inventory preview/addition.
3. Forward the commit to the real server, consume its successful response in the
   test controller, and deliberately withhold it from the browser. Verify one
   physical copy, receipt, member and audit, then SIGKILL the exact owned browser
   container. Require terminal exit137, no OOM and an actual new lifetime on restart.
4. Reopen the same private profile. Verify authentication, the committed card,
   two remaining cards, saved reviews, original bytes and a foreign-owner refusal.
   Replay the exact original request, retained by the test controller, without
   changing the ledger. Complete the next ordinary explicit UI addition and
   preserve the final pending card and all original processing jobs.
5. Stop the owned browser before database cleanup and compare all85 public-table
   full-row fingerprints with the baseline. Failures preserve diagnostics and
   the failed profile; uncertain browser termination preserves recovery records.

The interruption is a controlled server-success/client-acknowledgement window.
It is not a natural network fault, operating-system power loss, host/database/web
restart, Windows browser result or proof for every interruption point. The test
controller retains the replay request; this does not claim that the UI persists
arbitrary in-flight request bodies. It does not complete broad #310/#302.

## Ownership and reproduction

Use a freshly migrated disposable review database, private upload root and
matching production application image. The web container must carry the exact
`mtg.run`, `mtg.browser-loss.nonce` and `mtg.fixture.role=browser-loss-web` labels.
Acquire the repository's shared local runtime claim and inspect current capacity
before execution. Preserve other active reviews and data.

The Linux controller needs Docker CLI, a Docker socket, locked compatible
Playwright/Chromium and Sharp dependencies. It shares only the fixture web's
network namespace, making its loopback application and DevTools endpoints private.
Set:

| Variable | Required value |
| --- | --- |
| `MTG_BROWSER_LOSS_TEST` | `1` |
| `MTG_REVIEW_ACCEPTANCE_TEST` | `1` |
| `MTG_INVENTORY_TEST_CONTAINER` | Full immutable fixture web container ID |
| `MTG_INVENTORY_TEST_DATABASE` | Exact disposable `review\w+` database name |
| `MTG_BROWSER_LOSS_RUN` | Unique `acquisition-browser-loss-310-...` owner run |
| `MTG_BROWSER_LOSS_NONCE` |32hex characters matching the fixture web label |
| `MTG_BROWSER_LOSS_IMAGE` | Exact qualified browser dependency image SHA256ID |
| `PLAYWRIGHT_BASE_URL` | `http://127.0.0.1:3000` inside that private namespace |

Run the named spec with one worker and `--max-failures=1`. The controller creates
each browser itself, copies the checked-in launcher, verifies its bytes and uses
no browser host mounts. Every interrupt/start/stop/removal rechecks the exact ID,
image, run, nonce, role, network, mount absence and actual running/terminal state.
Ownership unit controls refuse foreign identities, mounts and uncertain states.
An old timestamp, name or observation timeout never permits an interruption.

The parent retains current source/image/archive and lifecycle/failure records,
verifies successful restoration, and retires only its own temporary controller,
web, database, network and disposable data volume. Release the exact runtime
claim only after owned operations and children are terminal. Do not point these
opt-ins at production or an existing review stack.

## Local result - October 24, 2026 UTC

Both actual cases pass: desktop1366 in22.8seconds and phone320 in19.5seconds,
45.0seconds overall, two passes and no skips. Each browser has the required
exit137 at the declared interruption, restarts with the same container/profile
and a new lifetime, and preserves the completed first addition. Exact request
replay is effect-free; the next explicit UI addition produces exactly two total
copies, receipts, members and audits. One card remains pending. Saved reviews,
all processing jobs, original photo identities/bytes and the web lifetime remain
unchanged. Foreign-owner original-photo access returns403. Both complete85-table
baseline pairs restore. Desktop and phone screenshots were inspected; the
confirmation and recovered state remain usable without horizontal overflow.

The application is built from main `a8aa1f8949e18648cd26f575db776a70facf5308`,
including the approved #955 merge. All1,287 declared inputs are bound by manifest
`b96ea1830ec1d4a5bbad575d9f7b72a529c4295b854200ee9b8b0f823ddc5cab`;
the actual image is
`sha256:11d13e2e309389983851fb2612b8d9970f9eb77c0a31712e336cdc88cc83ab07`.
The passing seven-file browser harness archive has SHA256
`616f70af13b3e836959d1392ee64c845f7edc951b29c34bf8b4adf0794eeb7cc`.
These additions change tests/documentation only; no application input is changed.

Two earlier attempts remain failed evidence. The first stopped before the
declared interruption because an externally connected CDP context does not
inherit Playwright's relative-URL base. Explicit fixture-origin URLs correct it.
The next attempt passed desktop and reached the restored phone ledger, then
failed to read an off-screen virtualized card. Explicitly scrolling its wrapper
before inspection/selection corrects that test step. All three earlier baseline
pairs also restore. Neither failure is attributed to a product defect.

The two ownership unit controls pass with no skips. The initial harness typecheck
exhausted its1,408MiB Node heap; the admitted1,792MiB retry passes, with no cgroup
OOM. The application production build/types/client check also passes. Required
final-head CI, independent review and resource retirement are recorded on the
delivery PR and current repository checkpoint. These local results retain the
declared boundary above; no merge, deployment or broad release acceptance is
established by this report.
