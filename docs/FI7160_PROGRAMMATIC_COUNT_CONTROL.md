# Programmatic fi-7160 count control

## Scope — October 3, 2026

The repaired diagnostics passed supervised one-, two-, five- and ten-card physical
boundaries with the required remainder wholly in the hopper and clear transport.
All originals, twelve settings restorations and clean actual process exits were
verified. [Staged requalification](FI7160_GUARDED_REQUALIFICATION.md) preserves the
original failed ten-card boundary and shutdown evidence. Those passes establish
the tested profile; integrated website acceptance remains a separate gate.

Helper0.4.2 adds a version2 native preparation contract for the explicit counted
PaperStream source. The old version1 physical entry remains refused before any
source access. Generic WIA/TWAIN routes stay unqualified for physical count control;
there is no generic fallback after a counted refusal.

Preparation requires the exact driver `3.40 3.40.2.1815 Mar 16 2026`, protocol2.4,
PaperStream source, finite target, legacy x86 DSM, twelve exact standard settings,
600 DPI native RGB24 simplex, centered current2.7-by-3.6 frame, AutoScan false and
blank-page removal disabled. The observed vendor UInt16-zero invariant is read
and rechecked; it is a correlation with separately observed Cards/Pre-Pick Off,
not an official capability mapping. Vendor SET is forbidden.

The helper requires typed, versioned source/settings proof before accepting
preparation. The native companion rechecks the full profile immediately before
its only Enable. Website START still follows durable spool/binding creation and
the authenticated server claim; replay recovers saved images without reopening a
feed. Stop drains the existing count and prohibits later segments. Early empty
allows an explicit same-logical-batch refill, and capacity-bounded section series
requires explicit selection/Start of the next section. No diagnostic stage starts
the next stage automatically.

Success requires twelve settings restored, source/DSM closure, owned-loop join
and the actual child exit0. Restoration, missing closure proof or late exit errors
produce reconciliation/error while retaining every original, including overflow.

## Verification

### Everyday count recording

Clean runs from the qualified counted source use one durable front image per card
as the count. The operator does not have to count exits or enter an exact total
before resuming or choosing another section. Each refill confirms only its own
new images; earlier cards and reviews stay in the same logical batch. A clean
zero-image empty attempt can be resumed after loading cards.

The stored receipt explicitly records an image-count assumption. It does not
claim an operator observed the exits, an empty hopper or clear transport, and
device physical boundaries remain unknown. Source qualification, durable Start,
contiguous retained originals, target bounds, clean completion and native closure
still apply. Errors, interrupted outcomes, overflow and uncertain candidates
retain manual recovery. Explicit refill/next-section Start and persistent Stop
remain unchanged. A later physical observation can replace an automatic receipt.

Motor-free process fixtures cover stale/wrong driver/source/frame, missing or
malformed readback/invariant/blank proof, no-feed prepare/close and denied Start,
early empty, retained overflow, restoration/closure and late process-exit failures.
The direct legacy route and stale version2 requests refuse before scanner access.
Build and final native regression suite passed, including preparation-close failure.

`counted-prepare <request.json>` uses the actual helper/backend/native pipeline with
an empty hopper. Both backend and native route prohibit Start in this mode. It
opens/configures/readbacks/closes only and requires successful actual restoration
and exit, printing the native proof. Obtain fresh hopper AND transport empty/clear
confirmation before running it. It neither connects to a website nor creates a scan
spool or acquisition authorization.

After the desk move, fresh hopper AND transport empty/clear confirmation permitted
the actual helper `counted-prepare` check. Native version2 acknowledged the exact
source/driver/protocol, frame, all capture readbacks, blank retention and observed
invariant, with feeder empty. It restored twelve settings, closed source/DSM and
joined its loop, reported zero Enable calls/images, and both actual native and held
helper exits were0. Empty stderr and no remaining scanner owner were verified.
This passes actual programmatic no-feed preparation and clean closure; it does
not establish an integrated transfer result.

The complete helper0.4.2 installer built with source/notices and connection/native/
discovery selfchecks. The cumulative local Docker review is loaded; a sole vetted
local source helper ran the supervised website sequence below. Prior installed
and production helpers remain stopped. No Inventory addition, merge approval or
production deployment occurred.

## Supervised website section sequence — October 3, 2026

A test-only seven-card box has sections A2, B3 and C2. Count control selected the
fresh section capacity automatically, without a manual count override.

| Stage | Requested | Loaded | Saved | Operator observation |
| --- | ---: | ---: | ---: | --- |
| Section A | 2 | 3 | 2 | Two undamaged exits; one wholly in hopper; clear transport |
| Next section B, early empty | 3 | 1 | 1 | One undamaged exit; empty, clear hopper and transport |
| Same B batch, explicit refill | 2 remaining | 3 | 2 new | Two undamaged exits; one wholly in hopper; clear transport |

Each run closed cleanly through the guarded actual-exit/restoration contract.
Refill created segment1 at sequence offset1 in the same logical B session,
preserving the first card and bringing its saved total to three. Physical
reconciliation is saved separately for each segment. All five private originals
are retained; recognition and downstream processing completed. Test reviews were
not committed and original Inventory quantities and full-row hash are unchanged.

After B completed, the operator-directed next-section form left the choice blank.
Selecting C exposed its two spaces but sent no Start. Stop persisted on the series
root, returned to the saved B batch, survived refresh and removed continuation;
there are still only two logical batches and three physical segments. No C run or
native worker was created. The operator subsequently removed the remaining card
and confirmed both hopper and transport empty and clear.

The reservation display repair shows A's two and B's three held spaces separately
from Inventory counts, with both sections full and C's two spaces available.
Desktop and phone simulated series/refill/Stop checks and all802 core tests passed;
see [section series](SCANNER_SECTION_SERIES.md). The cumulative review also includes
helper0.4.3's [single connection startup](SCANNER_CONNECTION_SELECTION.md). The
installed helper passed empty preparation, ordinary chosen startup, idle Close
and reopening. Switching and Close during an active scan remain unverified.
The small physical sequence above used the unchanged tested0.4.2 helper.

This passes the scoped small website capacity, explicit next-section, early-empty,
same-batch refill and persistent Stop gates. A larger logical83-card hardware batch,
connection switching, active-run Close and broader reliability remain unfinished.
Use comfortable small hopper refills; diagnostic eleven-card loading does not
justify an83/84-card stack of thick cards. Every new feed requires fresh supervised
loading/readiness and physical result confirmation; software tests do not authorize
unattended feeding.
