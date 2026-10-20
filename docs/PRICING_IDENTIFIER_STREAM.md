# Streamed MTGJSON identifier import

Issue #867, related to #854. The local scheduled identifier job retained the
Node error `Cannot create a string longer than 0x1fffffe8 characters`. The
configured public AllIdentifiers endpoint is confirmed. One complete public
entity is pinned with its provider checksum before/after capture: 650,524,457
decoded bytes, SHA256
`d39926c2ab129bfdbe8a141c23d15f5559931b4cb4e4fd75adea215408cd7471`.
The HTTP entity tag describes a different representation size; it is not used
as a decoded-size claim. Current-input qualification does not establish the
exact bytes returned to the original failed job.

The worker now tokenizes and validates the entire response, retaining only
entry keys, UUIDs and Scryfall IDs before calling the unchanged extractor and
unchanged batched publisher. No app write begins before a valid end of input.
This does not make the existing multi-batch database publication atomic: a
database error after an earlier committed batch retains its prior behavior.

Packed scalar assembly is disabled. Ignored card text, arrays and numbers are
validated without joining them into whole strings/objects. Retained keys and
identity strings are detached from decoded input chunks using UTF-16 copies,
preserving even unpaired surrogate semantics. A partial reference harness
initially hit its 256MiB heap limit; a subsequent run hit its 180-second total
deadline. Both remain failed evidence. The corrected reference detaches its
retained keys too and requests only the packed tokens its assembler consumes;
the same heap limit, complete-field comparison and deadline are retained.

The small identity projection remains proportional to feed entries. Explicit
guards fail the job on more than 500,000 entries in either shape, 64Ki UTF-16
units per key/selected field, 64Mi accumulated retained identity units, or
nesting deeper than 128. These guards never silently truncate a feed or mark
partial input successful. The ordinary public payload has substantial margin;
future incompatible inputs require investigation rather than raised limits.

Both wrapped and bare-object input, whitespace/fallback rules, first Scryfall
duplicate, JSON duplicate properties and JavaScript numeric-key ordering are
preserved below the bounds. HTTP errors, malformed/truncated tails, abort and
stream errors fail before publication and close streams. Failed job history
is preserved. This change does not retry/reset/replay existing jobs, change
price/currency semantics, alter correction policies, repair historical data,
or deploy production.

The maintained offline full-input tool accepts a local pinned file and its
provider SHA256. A separate whole-card assembler plus the legacy extractor
produces the reference for every mapping; count and order-sensitive digests
must match the selective projector. It measures decoded bytes, UTF-16 length
against Node's string bound and process RSS. It never fetches or publishes.
The PostgreSQL verifier exercises the actual worker against owned databases,
including duplicate/conflicting/existing mappings, sibling fields, malformed
tails/HTTP failures without writes, identical replay and preserved old jobs.
Exact CI, built-image, full-feed and local delivery results live in the PR and
worker checkpoint. Incomplete qualification stays draft; independent review,
individual merge approval and production delivery remain separate.
