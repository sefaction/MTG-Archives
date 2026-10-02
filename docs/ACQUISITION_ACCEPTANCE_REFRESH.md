# Current acquisition browser acceptance assertions

Issue #554 described three stale expectations against merged application behavior.
The incremental library list's bounded 12-to-14 acceptance was already fixed in
merged PR #567 and is left intact. This batch corrects two singular prepared-photo
expectations and the current25 static-route census. The real 200% zoom overflow
assertion now runs before the route census, so future census drift cannot hide the
overflow result. Application wording, pagination and other capture behavior are
unchanged.

Local targeted acceptance passed3/3 with zero skips (1.4minutes):

- Library14-card capacity/bounded two concurrent uploads, incremental final rows.
- Existing intake response-loss, limit, same-slot retake and single prepared photo.
- All25 discovered static routes reachable with actual200% Chromium tab zoom and
  no page-wide horizontal overflow, using a disposable Chromium profile.

The zoom run used an owned temporary ADMIN account rather than modifying an
existing user's authentication. Initial cleanup removed the account/session but hit a foreign-key dependency on
the player's automatically created location. The owned zero-inventory location
and player were then removed; no matching fixture accounts/players remain.
This does not qualify real Android camera or physical scanner behavior; the intake
case uses its existing software-only media fixture and the private real-photo
corpus extension was not enabled. Existing hardware/corpus gates remain separate.

Typecheck passed. The same cumulative local #569/#571 application remains loaded;
test/docs edits are outside its explicit509web build inputs, so no app rebuild or
service replacement is needed for this batch. Individual review/merge approval is
still required. #554 is not closed until this batch merges.

After fixture cleanup, all baseline conservation hashes matched: Inventory10,280
rows/12,482 copies,81 saved reviews, and907 original photo identities. No original
Inventory, saved review, or photo digest changed.

The broader 100-input fixture also had stale setup: it tried selecting Batch
finish while Simple view had defaults collapsed. The first run was deliberately
stopped after confirming zero photos/jobs and retained as FAILED before throughput;
owned fixture cleanup was zero users/sessions/Inventory. The fixture now opens
Advanced as the passing live-recovery test does, and bounds ordinary UI actions to
15 seconds rather than spending its entire 30-minute processing allowance there.
The 20-minute native printing gate and all input, review, resource and cleanup
assertions remain unchanged. Its fresh full run is recorded separately.
