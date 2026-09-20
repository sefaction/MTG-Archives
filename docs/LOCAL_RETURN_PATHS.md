# Local login and admin-mode return paths

Issue #253 covers both unvalidated post-login destinations and lost protected-page navigation.

`safeLocalReturnPath` accepts only application-relative paths. It rejects external URLs, protocol-relative destinations, backslashes and control characters, including suspicious decoded paths and paths that become authority-like after URL normalization. Invalid values fall back to `/dashboard`. Ordinary paths, query strings and fragments remain intact; URL normalization is applied before returning the destination.

Login validates the submitted field server-side, not just its rendered default. It reads middleware's `next` parameter and retains the older `returnTo` query parameter for compatibility. A failed password attempt retains the validated destination for retry. Forced password rotation continues to take precedence over returning to a page.

Admin-mode toggles use the same validation while retaining their existing page/query/scroll behavior. The mode-change action still performs its normal authorization before redirecting. Middleware no longer copies unrelated original query parameters onto the login page; the full intended path/query is carried in `next`.

## Local regression evidence

Before the fix, a synthetic browser scenario confirmed an external destination was rendered into the login form unchanged. The protected-route scenario separately confirmed that the requested `/settings` path/query was replaced by `/dashboard`. A first test harness assertion assumed the ordering of query parameters; it was corrected to compare parsed URL fields before recording the second baseline failure. No external navigation or production probing was needed.

Units cover valid paths and malformed/external/normalized variants. The browser cases submit tampered login/admin-mode hidden fields, verify same-origin fallback, then exercise protected-page login, a wrong-password retry and both mode toggles. External requests are intercepted and aborted in the tampering case; credential traces/video/screenshots are disabled. Fixtures are UUID-scoped and removed in `finally`.

```powershell
$env:MTG_LOCAL_PILOT_TEST = '1'
npm.cmd run ui:test -- tests/ui/login-return.spec.ts
```

Validation results are recorded in the pull request and WORK_CHECKPOINT.md. This is a focused navigation/security correction, not a complete authentication audit.
