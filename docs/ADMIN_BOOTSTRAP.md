# Startup administrator provisioning (#242)

Startup previously ran an upsert that overwrote an existing administrator's password, role, active status, profile, owner metadata and forced-password-change flag on every restart. This was reproduced when the local Docker rebuild redirected an established session through password setup.

Bootstrap is now create-only. It checks username case-insensitively, matching login behavior, and preserves every existing account and owner field. This includes disabled/non-admin accounts and missing owner links: startup is not an account-repair or privilege-escalation operation. Use authenticated account/admin controls for deliberate edits and password resets; changing the seed password is no longer an implicit reset mechanism.

Fresh provisioning still creates an active administrator, linked owner and hashed temporary password, with first-login password change required. Account and owner are created atomically. A transaction advisory lock serializes concurrent provisioning; owner names/display names avoid collisions without adopting an unrelated owner.

## Checks

- Three behavior tests cover fresh creation, case-insensitive existing identity (including disabled/non-admin users) and owner-name collisions.
- `scripts/verify-admin-bootstrap.ts` is an opt-in real-PostgreSQL fixture. It races two differently cased startup requests, checks one account/owner, then changes credentials, role, active status and profile and verifies exact preservation on repeat. It removes only its unique synthetic records, even on assertion failure.
- Run only against the local disposable snapshot:

  `docker compose -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.smtp-test.yml exec -e MTG_LOCAL_PILOT_TEST=1 web npx tsx scripts/verify-admin-bootstrap.ts`

- Docker restart verification compares an in-memory fingerprint of the existing administrator and owner before and after rebuild; no credentials or account records are written to evidence. The exact results and cumulative image are recorded in the PR/checkpoint.

This batch does not change session/cookie authentication, introduce a remote recovery endpoint or alter production data.

Local application `2f3869c` passed Docker production build and all six manifest guards. The web container was healthy and returned HTTP 200. The existing administrator/owner fingerprint was identical before and after restart. The real-PostgreSQL concurrent/preservation fixture passed and its synthetic records were removed. Unit/browser suite totals are recorded on the PR.
