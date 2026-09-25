# Administration workspaces

Administration retains its existing routes and Admin-mode authorization. Shared navigation exposes Overview, Users, Backups, Card data, Pricing worker, Notifications and Announcements. The global Settings organization is unchanged.

## Retained tasks

- Overview shows system counts and Scryfall health. Connection diagnostics are expandable. Users lives at `/admin?view=users`, with name/username/email/owner search, bounded results and existing create/account/password forms.
- Backups starts with creation and recent downloads. Upload and storage/restore guidance are separate disclosures. Each archive keeps exact-filename and RESTORE/DELETE confirmation inside its own disclosure. The history table scrolls locally.
- Notifications shows queue-wide totals and filters the latest 30 jobs by text/status. The displayed scope is explicit. Retry actions and attempt details remain attached to each job; local-only diagnostics are expandable.
- Pricing worker health reads bounded recent jobs, heartbeats, runs and logs asynchronously. It does not scan the entire snapshot table on page load. Exact history counts are explicitly requested, cached five minutes per web process and share a single in-flight scan. Deferred/error states never masquerade as zero. The read-only PostgreSQL subprocess has a statement timeout, process timeout, output cap and sanitized errors.
- Automatic worker-health updates use Next router refresh and can be paused. They preserve client history totals, focus and open disclosures rather than reloading the document during an expensive request.
- Metadata refresh/bracket tools and announcement settings retain their original behavior and guards, with the same Administration navigation.

## Validation and review

`tests/ui/admin-workspaces.spec.ts` exercises synthetic admin/member/anonymous scopes, user lookup/edit, bounded recent jobs and local diagnostic retry, backup disclosures, pricing loading/failure/retry, concurrent dashboard responsiveness, responsive routes and themes. It does not restore the database, send external notifications or enqueue a full remote pricing refresh.

`scripts/verify-pricing-db-query.ts` exercises actual PostgreSQL Unicode/zero/empty results, event-loop responsiveness during pg_sleep, statement timeout, sanitized errors and read-only connection mode. CI runs it alongside the existing PostgreSQL import checks. Exact completed results and the running cumulative image are recorded in WORK_CHECKPOINT.md and LOCAL_REVIEW_BUILD.md.

The baseline audit reproduced a 31.7-second synchronous global history query (#321) and phone job-history overflow (#323). Audit screenshots remain local under ignored test-results. No schema, production operation, permission redesign, Acquisition or Playtest change is included.
