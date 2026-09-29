# Bounded recovery of retained photo uploads

This batch addresses #468 through the existing intake path. Recognition algorithms,
capacity accounting, user review and explicit Inventory commit are unchanged.

## Behavior

An upload keeps the same URL/slot/key/generation/input kind, original Blob and
existing 60-second overall deadline. Two HTTP slots and ten pending browser
photos remain the intake bounds. Connection failures, temporary gateway/time-out
responses, and explicitly marked database serialization/deadlock conflicts allow
two automatic retries with short increasing jittered delays.

The same bounded engine applies to the existing idempotent slot reservation,
preserving one request key through a conflict or lost acknowledgement. Control,
review and Inventory operations are not included. A real prior library burst
saved/prepared 10 photos but stopped while admitting the remaining two; its traced
response carried `retryable: true`. This is separate from transfer retry.

The server marks only Prisma P2034 or P2010 with SQLSTATE 40001/40P01 as retryable.
It exposes no native diagnostic text. Ownership, capacity, stale generation,
identity rejection, unclassified errors and invalid acknowledgements are not
automatically retried. Pending uploads show their retry progress.

After exhaustion, the existing visible Retry remains available. The original
stays in browser storage until a real ready acknowledgement; reload can resume
that same identity. A replay of an already-ready photo does not rewrite its files
or add another artifact/candidate. This is bounded transient recovery, not a
promise that persistent infrastructure failure can be repaired automatically.

## Verification

Focused checks cover actual server retry hints/redaction, unchanged URL/blob,
deadline cancellation, transient versus domain rejection, strict ready handling
and bounded exhaustion. The local browser case selects 12 synthetic photos,
drops real successful reservation and upload ACKs, injects marked conflicts,
leaves one domain rejection manual and exhausts another photo before reload.
It checks retained identity, 12 photos/artifacts/slots/candidates, capacity,
a maximum of two concurrent uploads
and zero Inventory writes. These fixtures measure intake reliability, not accuracy.

The existing intake/reload/retake/commit test retains its explicit manual fallback
by dropping the first ACK and failing the next two requests. The existing 12-file
capacity/streaming case also passed. Seven focused checks, TypeScript and focused
ESLint passed. All three CI checks passed at application commit `7619ec3`.

The cumulative local Docker browser run passed all three affected cases in 50.5s:
library capacity/streaming (18.8s), existing reload/retake/commit (17.1s), and the
new fault/reload case (13.3s). Three reservation attempts reused one request key,
including a successful server reservation whose ACK was lost. No extra slot was
created. The fault fixture retained all 12 images and made zero Inventory writes;
the separate legacy case still exercises explicit commit. Phone retry/recovered
screenshots at 320/390 CSS pixels were inspected, with no page-wide overflow.
New owned fixtures were cleaned. The earlier admission failure and trace remain
preserved privately; it was not hidden by a larger timeout or unchanged rerun.

The verified 457-input local source digest is
`af9b925ddf29c86212f47b3ac9df5bf9ba46f082e7ae9827946744e81337f320`.
It temporarily combines #486/#487/#488/#489/#490/#492 and qualification #491;
this independent-main PR contains no recognition/UI dependency or merge approval.
Five ordinary acquisition workers run with one printing replica. Full large-batch
recognition accuracy, infrastructure-loss recovery and production qualification
are not established by these synthetic intake checks. Production/scanner hardware
unchanged. A sanitized summary is in
`tools/acquisition-eval/upload-recovery-results.json`. Recognition #463 stays open.
