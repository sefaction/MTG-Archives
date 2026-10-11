# Public inventory when JavaScript is disabled

Issue [#708](https://github.com/sefaction/MTG-Archives/issues/708) allows a clear
scripts-required message as the supported fallback. Public inventory depends on
browser scripts for its streamed results and interactive browsing controls.

The new synchronous route layout sends an explanation and ordinary reload link
outside the page's loading boundary. With scripts disabled, its `noscript` style
hides both the loading skeleton and interactive workspace. Reload preserves the
current filters. With scripts enabled, the existing page, public visibility
rules, search and controls continue to render normally.

## Qualification

The original local image reproduced a visible loading skeleton, no visible Public
inventory heading and no fallback. The new 1366px browser regression fails on
that image at the missing fallback heading, establishing its negative baseline.
Private baseline evidence is retained in `.local-data/public-noscript-20261010`.

Current-schema type checking and all 877 unit tests pass. The initial host attempt
used a stale generated Prisma client and sandbox-restricted Git fixtures; after
generating the current client and running outside those restrictions, checks pass.
The required-installer Docker build passes production compilation and all 13
client manifest guards. Its existing 596 build inputs exactly match the previously
qualified running cumulative image; the sole application addition is this layout.

All four browser cases pass on the loaded image in 4.4 seconds. The new regression
is read-only: it covers disabled scripts at
1366/390/320px, hidden skeleton/workspace, overflow, keyboard reload/filter
preservation and normal scripts-enabled filter opening/closing and search
navigation. The 320px rendered screenshot was inspected: text and reload link
fit without clipping. No assertion deadlines were increased.

An initial normal-browser probe clearing every filter exceeded its 10-second URL
assertion on both the new and previous image, with the same local database. The
previous image was tested in a temporary read-only web container at port 13008,
then stopped and automatically removed. This is tracked in [#721](https://github.com/sefaction/MTG-Archives/issues/721): separate full-collection
navigation behavior, not a qualification of its latency. The focused regression
uses a filtered search navigation. A desktop filter panel initially remained open
after the test pressed Escape; the test now uses its supported Close filters
button (the phone panel is modal). No product change addressed that test mistake.

The cumulative local review uses main `5e7adbf` plus this fix, with the existing
scanner installer. Web image:
`sha256:1ec9ef474d1ff6daf94d1cac38c1245c0018c5258b72c6cec565bf013c9289e7`.
Exact source fence: 597 inputs,
`06d27b52b1ee45d277210bd028cd587041343fe73617ffa86ce7b132f6284eec`.
Host login returns HTTP 200; all 12 other running services retain their original
container identities, images and start times. Only the web service was reloaded.
The first Compose attempt did not mutate services because required model mount
variables were absent; reusing the existing read-only model paths allowed the
web-only load. Existing source inputs are conserved; no fixture records or scan
files were created by the regression.

No production configuration, scanner behavior, recognition policy or database
schema changes. The issue remains open and claimed until its PR receives
individual approval and merges through the separate review workflow.
