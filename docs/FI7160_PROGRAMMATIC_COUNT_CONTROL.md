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

Motor-free process fixtures cover stale/wrong driver/source/frame, missing or
malformed readback/invariant/blank proof, no-feed prepare/close and denied Start,
early empty, retained overflow, restoration/closure and late process-exit failures.
The direct legacy route and stale version2 requests refuse before scanner access.
Build and initial native regression suite passed; final follow-up checks are pending.

`counted-prepare <request.json>` uses the actual helper/backend/native pipeline with
an empty hopper. Both backend and native route prohibit Start in this mode. It
opens/configures/readbacks/closes only and requires successful actual restoration
and exit, printing the native proof. Obtain fresh hopper AND transport empty/clear
confirmation before running it. It neither connects to a website nor creates a scan
spool or acquisition authorization.

Actual native empty preparation, new complete installer/local Docker delivery,
and fresh supervised website count/capacity/refill/next-section physical tests are
pending. Existing installed helpers remain stopped. No new feed, Inventory write,
merge approval or production deployment is implied by this implementation.
