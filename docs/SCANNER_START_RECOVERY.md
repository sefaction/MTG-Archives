# Website scanner Start recovery

Start recovery #527/#528 is merged. Rejected-Start setup recovery #529/#541 is
based on approved main0d1d18a and is independently unapproved. This does not
change native acquisition, recognition, review or Inventory commit.

The browser saves one validated, immutable scanner Start request in per-tab,
per-account session storage before sending it. Settings and destination are
locked until its outcome is recovered. Source polling cannot change that intent.
No connection credentials or images are stored there.

An uncertain POST response triggers an owned, read-only lookup by the existing
request identity. Reload also performs only that lookup. Retry first recovers an
accepted batch; only if none is found does the explicit retry resubmit the same
request. The existing server identity/payload/ownership/capacity and native START
gates remain authoritative. Missing lookup results do not prove no feed occurred
and never justify generating a new request identity.

The lookup repeats current ownership and role checks but does not require the
helper to remain online. An already accepted run is recovered even when current
capacity or connectivity changed. Recovery itself does not authorize START.

Storage failure prevents a new scanner POST with guidance. Photo-only input does
not require this storage. Malformed saved scanner state fails closed; Recent
batches remain available. A late ACK cannot erase a newer intent.

## Evidence and limits

The original browser test needed a timing correction: waiting for the failed
response before the next source poll reproduced the failure. Earlier prematurely
passing runs are not evidence of recovery. The corrected baseline lost its batch
after refresh/retry and retained its failure trace privately.

Focused storage tests cover account isolation, reload, old ACKs, invalid content,
unexpected fields and unavailable storage. Disposable scanner database checks
cover missing/foreign identities, offline accepted-run recovery and unchanged
execution authorization. Local browser cases inject an accepted POST with lost
acknowledgement and a POST that never reached the server, plus a recovery outage,
source polling, locked fields, reload and explicit retry. Test agents never run a
helper or motor; photos and Inventory remain empty. The first grouped local
browser check passed 3/3 in 47.1 seconds. On the final image the two recovery
cases passed 2/2 in 32.8 seconds, including safe setup edits after settlement and
photo-only creation without scanner-start storage. A prematurely started test
failed at login while the recreated web container was starting; its log is kept.
The successful rerun required healthy web and HTTP 200 first. Exact source/image
and CI heads are recorded in the checkpoint.

Pending intent is per tab, not a cross-computer or cross-tab coordinator. Closing
the tab can lose that browser intent; existing server unfinished-run checks still
prevent a second feed through the same agent. No timeout disposes native state.

## Changing setup after a rejected Start (#529)

Change scanner setup asks the server to retire the exact original request. An
already accepted batch opens instead, including when the helper is offline.
The action neither stops that accepted batch nor sends another START.

Without a ScannerRun, the server still checks the owned request, current access,
the durable native START marker and every partial acquisition artifact, photo,
capture slot, event, candidate, count correction and Inventory receipt. Saved or
uncertain evidence prevents retirement. A missing run lookup alone is not proof.

Each creation phase and retirement share a transaction advisory lock. An
immutable, fsynced appdata marker binds the retired UUID to its owner and
canonical payload hash. It is published before cancelling an empty partial
session; rollback, late creation and restored database rows cannot revive that
request while the marker remains. Retry completes the same cancellation. The
normal backup/restore requirement to preserve scanner-control appdata remains;
this is not protection against losing both database and durable control files.

The browser keeps pending intent/settings locked through a lost cancellation
acknowledgement. Only a confirmed retirement clears that exact stored intent and
allows a new UUID. Destination, scanner settings and review defaults are retained
as preferences; capacity and authority are checked again for the new Start.
Changing setup does not recognize cards, erase images or add Inventory.

File identity/replay/restore/malformed/path checks and disposable database
phase races, partial cancellation, existing native authorization, foreign and
inactive owners, saved-slot denial and receipt integrity passed locally. Core
verification passed744 units and the Windows production build. The updated two
browser cases now pass2/2 in11.6seconds against the cumulative local image:
real capacity rejection, lost retirement ACK, reload, retained destination,
late original replay rejection and a fresh request identity; accepted native
START/lost create ACK and offline adoption retain one batch/session and send
no additional create or physical feed. Desktop1366x768 and phone320x700
screenshots were inspected without horizontal overflow. Owned users, sessions
and agents returned to zero; no Inventory copies or originals were added.

The first resumed browser run passed accepted-batch recovery but failed a
stale fixture assertion expecting Change while the destination editor was
already open after retirement. Its trace/video/screenshot are retained privately;
only the fixture assertion changed before the successful rerun. No product
failure or extra timeout is inferred from that attempt. Typecheck and focused
fixture lint pass. Exact image/source and final CI remain in WORK_CHECKPOINT.
