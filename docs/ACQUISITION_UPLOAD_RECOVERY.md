# Bounded recovery of retained photo uploads

This batch addresses #468 through the existing intake path. Recognition algorithms,
capacity accounting, user review and explicit Inventory commit are unchanged.

## Behavior

An upload keeps the same URL/slot/key/generation/input kind, original Blob and
existing 60-second overall deadline. Two HTTP slots and ten pending browser
photos remain the intake bounds. Connection failures, temporary gateway/time-out
responses, and explicitly marked database serialization/deadlock conflicts allow
two automatic retries with short increasing jittered delays.

The server marks only Prisma P2034 or P2010 with SQLSTATE40001/40P01 as retryable.
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
and bounded exhaustion. The local browser case selects12 synthetic photos,
drops one real successful ACK, injects two marked conflicts, leaves one domain
rejection manual and exhausts another photo before reload. It checks retained
identity,12 photos/artifacts/slots/candidates,capacity,maximum2 concurrent uploads
and zero Inventory writes. These fixtures measure intake reliability, not accuracy.

The existing intake/reload/retake/commit test retains its explicit manual fallback
by dropping the first ACK and failing the next two requests. The existing12-file
capacity/streaming case also remains applicable. Local Docker and CI acceptance
are pending; no complete PASS is claimed yet. Production/scanner hardware unchanged.
