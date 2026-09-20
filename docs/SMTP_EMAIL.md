# SMTP notification delivery

Issue #151. Optional email mirrors stored trade and wishlist-digest notifications. All SMTP work runs in the notification worker, never in a trade transaction or page request. Queue records contain identifiers only, not SMTP credentials, recipient addresses or inventory details.

## Production configuration (separate from local acceptance)

Set these server-side variables identically for `web` and `notification-worker`; the common Compose and flattened Unraid files forward them. Do not use the local capture overlay on a server.

| Variable | Meaning |
| --- | --- |
| `SMTP_ENABLED` | `true` to enable; defaults to `false` |
| `SMTP_HOST`, `SMTP_PORT` | SMTP hostname/IP and port; Compose defaults to port 587 |
| `SMTP_SECURITY` | `starttls` requires an upgrade; `tls` uses immediate TLS (set port 465); `plain` is for a trusted test relay only |
| `SMTP_ALLOW_INSECURE` | Must explicitly be `true` for `plain`; default false |
| `SMTP_FROM` | One sender email address authorized by your mail provider; no display-name syntax |
| `SMTP_USER`, `SMTP_PASSWORD` | Both set for password authentication, or both empty for an unauthenticated relay |
| `APP_BASE_URL` | Browser-visible HTTP/HTTPS origin, without path, credentials, query or fragment |

TLS certificate validation remains enabled. SMTP connection/greeting/DNS timeouts are 10 seconds and socket inactivity is 15 seconds. Debug/protocol logging is disabled. Transport failures are translated into fixed safe messages before being saved to retry history. Keep environment files and SMTP credentials out of GitHub and Foundry.

Users choose categories in **Settings → Email notifications**. Preferences default off, including existing accounts after migration. The existing account email is administrator-managed. No address means no email job, but ordinary local notifications continue. The existing local category switch governs whether a notification is generated at all; email mirrors those stored notifications rather than bypassing the category. The UI explains this dependency.

**Send test email** queues only to the authenticated account's stored address, at most one durable test job per minute bucket. Configuration errors are shown without supplied values. Queued means pending, not delivered: the page shows the account's latest 10 jobs and attempt history, with refresh. Administrators retain the shared delivery dashboard/retry controls.

Delivery reloads the active recipient, current address, notification ownership and current email preference. Missing/inactive recipients or a disabled category cause a visible failed attempt without sending, using the existing bounded retry behavior. If a user re-enables the category before retries expire, the pending notification may then send. Delivery is **at least once**: a crash after SMTP acceptance but before recording success can duplicate mail. Stable Message-ID helps correlation but is not an exactly-once guarantee.

Messages contain a generic event-category summary and same-origin app link, not card lists, quantities, prices, trade terms, or copied notification metadata. Text and HTML alternatives are included. No attachments, remote content fetching, tracking pixels, or arbitrary form-provided recipients.

## Local review with capture only

Use the optional `docker-compose.smtp-test.yml` after the usual common/local files. It pins Mailpit v1.31.2, clears authentication fields, directs web/worker to `smtp-capture:1025`, and exposes only its viewer on `http://127.0.0.1:18025`. No SMTP forwarding/relay is configured. Captured messages stay in the disposable container, bounded to 1,000 messages. Do not publish captures or real-user metadata.

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.smtp-test.yml up -d --build
```

The app stays at `http://127.0.0.1:13001`. Removing this overlay and recreating web/worker returns to the normal environment configuration; by default email is disabled. Removing the capture container discards captured test mail; no collection data is affected.

## Verification

- Unit tests exercise config validation/redaction, safe links, opt-in/no-address enqueue, identifiers-only payloads, recipient ownership/current preference checks, scoped minute deduplication, preferences and actual multipart SMTP delivery to a loopback receiver.
- `scripts/verify-email-delivery.ts` is explicitly gated to the local snapshot/capture configuration. Run it in the web container with `MTG_LOCAL_PILOT_TEST=1`. It atomically future-dates its jobs and uses a scoped test clock, so the ordinary worker cannot claim them and does not need to stop. It scopes queue claims to its unique fixture, records a real refused-connection failure, retries successfully into capture, verifies minimal mail, honors a post-queue opt-out and removes its fixture records/messages.
- `tests/ui/email-settings.spec.ts` requires `MTG_LOCAL_PILOT_TEST=1` and checks the container points to capture before creating its fixture. It verifies preference persistence, asynchronous test delivery/history, text/HTML capture, absent email, cross-account isolation, unauthenticated access and phone width. Only unique synthetic accounts and `example.test` destinations are used.
- The schema migration adds one default-false preference column and index. Deployment uses the ordinary migration runner before the notification worker starts.

Reference APIs: [Nodemailer SMTP](https://nodemailer.com/smtp), [message options](https://nodemailer.com/message), [Mailpit Docker](https://mailpit.axllent.org/docs/install/docker/), [Mailpit API](https://mailpit.axllent.org/docs/api-v1/). Actual test results and review-build identity belong in the PR/checkpoint.
