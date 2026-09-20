# Server-validated authentication sessions

Issue #251 replaces identity-only browser cookies with independent session credentials. Deployment requires everyone to sign in again; existing passwords and collection data are unchanged.

## Contract

- Successful password authentication issues a 32-byte cryptographically random opaque token. Only its SHA-256 hash is stored in `AuthSession`; the raw value is sent in the HttpOnly, SameSite=Lax cookie, never in URLs or logs.
- Every authenticated server request resolves that hash against the database, requires an active user and checks a server-enforced 30-day absolute expiry. Changing a browser cookie's expiry cannot extend it. There is no sliding or idle timeout in this batch.
- Sessions are bound to the current stored password hash. A password change invalidates old credentials even if performed through maintenance tooling rather than the UI.
- Login rotates the current browser credential. Self-service password changes revoke all sessions and issue one fresh session for the current browser. Logout deletes the server record, making a copied credential unusable afterward.
- Administrator password resets and account saves revoke the affected user's sessions. This includes role/active/forced-password-change edits and conservatively includes ordinary profile edits made through account administration. Re-enabling an account does not resurrect its revoked sessions.
- Legacy `boxleague_session` cookies and user IDs in `mtg_inventory_session` are rejected. Middleware cookie presence is only a routing optimization; server authentication remains authoritative.
- Login and password rotation clear the admin-mode cookie. Existing owner, role and explicit admin-mode authorization policies are otherwise preserved. Setting an admin-mode cookie cannot promote a non-admin user.

Credential verification and session creation share a transaction with a conditional user update, so a concurrent password reset/disable cannot issue a usable session from a previously checked password. Requests already authorized before a logout/reset may finish; this is not request cancellation.

## Deployment and operation

Migration `20260920170000_auth_sessions` adds one table and indexes, with cascading deletion when a user is deleted. Apply migrations before serving the new application (normal container startup does this). No data backfill or deployment secret is needed. Do not roll back to the old identity-cookie implementation as a recovery strategy.

Use HTTPS and `COOKIE_SECURE=true` on internet-facing deployments. The explicit insecure-cookie option is retained for local HTTP testing. Protect backups and database access; session hashes and password-derived fingerprints are still sensitive account metadata. Do not publish browser traces, cookies or database rows.

A database restore can restore previously valid session records. Before exposing a restored application to users, revoke restored sessions with an operator-reviewed `DELETE FROM "AuthSession";` against the **verified restored target only**, then require fresh login. Older archives may not contain the table; apply migrations first. The recovery drill does not expose a restored web server. Automated restore-time revocation is not implemented in this batch.

Expired records for a user are pruned during their next successful login. Rate limiting, MFA, login-event reporting, session/device management UI and scheduled global pruning remain separate enhancements; this change is not a complete security audit.

## Validation

The pre-fix local regression demonstrated that a synthetic identity-only cookie was accepted by an authenticated API. No real credentials or production systems were probed.

Unit tests cover independent token generation, hashed storage, malformed/unissued credentials, absolute expiry, password binding, disabled accounts and targeted revocation. Local browser tests use isolated synthetic accounts and disable trace/video/screenshot collection. They exercise the actual login, password-change, logout and administrator forms, plus replay rejection, forced password rotation, disable/re-enable and non-admin mode denial. Run only against the authorized local snapshot:

```powershell
$env:MTG_LOCAL_PILOT_TEST = '1'
npm.cmd run ui:test -- tests/ui/auth-sessions.spec.ts
```

At application `cd5c469`, all 558 unit tests, typecheck, Windows/Linux production builds and six manifest guards passed. The three dedicated security browser cases passed in 20.9s; full cumulative acceptance then passed all 37 serial cases with zero skips (3.1m). Docker is healthy, host HTTP is 200 and all 59 migrations are current. Synthetic users were removed and the snapshot retained 12,477 physical copies. No production testing or merge occurred. See PR #254 and `WORK_CHECKPOINT.md` for live status. Design reference: [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
