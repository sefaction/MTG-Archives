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
existing user's authentication. That account/session was removed after the run.
This does not qualify real Android camera or physical scanner behavior; the intake
case uses its existing software-only media fixture and the private real-photo
corpus extension was not enabled. Existing hardware/corpus gates remain separate.

Typecheck passed. The same cumulative local #569/#571 application remains loaded;
test/docs edits are outside its explicit509web build inputs, so no app rebuild or
service replacement is needed for this batch. Individual review/merge approval is
still required. #554 is not closed until this batch merges.
