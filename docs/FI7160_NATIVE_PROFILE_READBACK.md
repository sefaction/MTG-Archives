# Suspended native count-worker profile checks

The website's capacity, same-batch refill and explicit next-section framework is
implemented. Its physical count route remains suspended after the ten-card
prefeed failure in [602](https://github.com/sefaction/MTG-Archives/issues/602), pending
revised hardware qualification. This batch prepares additional refusal checks
without enabling that route or moving any cards.

The native companion now reads every configured capture capability, its image
frame and the observed driver invariant both after configuration and immediately
before its single acquisition Enable. It also checks the invariant before
configuration. These checks cover simplex, feeder/auto-feed/auto-scan, count,
native RGB24/600 DPI, inch units and the exact 2.7-by-3.6-inch frame. An unavailable,
changed or mistyped value refuses feeding before Enable.

The shared `GuardedFeedPolicy` accepts only a readable UInt16 zero for the observed
`0x80FD` invariant. This is a drift check using the separately observed profile;
it is **not an official Pre-Pick mapping**, does not establish visible Off, and
does not qualify or authorize physical feeding. No vendor capability is SET.

The early `helper-channel-v1` suspension remains before input, ownership checks,
message-loop creation, TWAIN sessions or driver calls. Diagnostic command/readiness
rules, fixtures and the generic hopper-drain route are unchanged. The existing
owned-loop lifecycle repair and retained-original delivery/recovery fences remain.

The native build compiles the existing shared guarded policy; release source
packaging and source-install fingerprints include that dependency. Installer CI
continues to rebuild the actual extracted source archive. Locked native/helper
build and policy, direct-suspension, transfer/refill/overtransfer, denial, retention
and recovery fixtures passed without hardware. These tests qualify software
refusal/recovery policies; actual native capability calls remain untested in this
new suspended route.

The next hardware step is still the repaired diagnostic's empty-settings/cancel
test after fresh empty/clear confirmation. No further feed is queued. Fresh small
physical counts must pass before integrated count/refill/section-series testing;
larger logical targets must respect the hopper's thickness-dependent load limits.
No production deployment or merge approval is implied.
