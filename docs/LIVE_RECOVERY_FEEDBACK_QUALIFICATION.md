# Live OCR recovery and independent feedback cleanup

Fixes [#726](https://github.com/sefaction/MTG-Archives/issues/726). Advances the
remaining live-recovery boundary in [#692](https://github.com/sefaction/MTG-Archives/issues/692)
and correction feedback under [#463](https://github.com/sefaction/MTG-Archives/issues/463).

The verifier's first feedback cleanup could throw before timer shutdown and
worker restoration. Report-write failure could also bypass acquisition cleanup.
Cleanup now independently attempts each required step and preserves every
failure in an AggregateError. Exact-owner cancellation, original acquisition
teardown and the late feedback sweep are retained. This repairs the verifier,
not a demonstrated historical production-worker failure.

The actual source's finally block is exercised with dependency doubles:
unchanged main fails three of six controls; corrected source passes all six.
Controls cover early feedback, report writing, legacy teardown and late sweep
failures, multiple retained failures, and ordinary recovery. These are sequencing
controls, not actual Docker restoration or full native workflow acceptance.

The existing 24-original actual OCR-crash case now preserves a deterministic
first normal-control photo for its disposable owner. Only that owner uses a
one-position, 100% fixture sampling override; real installation defaults remain
64 decimal GB / 2%, and its retained images are reused development evidence.
The saved unverified LP review, complete example/event/evidence rows and actual
independent original bytes are compared before and after the crash. Original
native lease/attempt, lost-acknowledgement, printing recall, incremental review,
Inventory and reload assertions and stage deadlines are retained.

Types and all three required checks pass on the initial implementation head.
An AST fence preserves all 92 original expectation calls and stage bounds,
adding 24 feedback expectations. Actual current-build checks verify all 597 web
inputs and actual native app/Python/reference sources. Native workers retain the
approved-main inventory-query/public modules while web has the separate #719/#724
changes; acquisition and recognition inputs match exactly. A fresh baseline
hashes all 1,094 ready originals, totaling 2,845,198,201 bytes, and records source
tables, substantive feedback and service states. The initial native-manifest
path assumption and separate-inventory source-fence rejection were setup
failures; no fixture or native acceptance was claimed for either attempt.

An actual local SIGKILL/early-feedback-error injection executes this source's
corrected finally block. It restores the same OCR container/image, attempts
all later steps, leaves the expected AggregateError visible, and independently
removes its seeded owner rows and private folder. This adds real restoration
evidence to the dependency-double controls. Its exact owned fixture is retired;
no other native job was active before the deliberate interruption.

The actual 24-original browser/native recovery case passes in 750.862 seconds,
with one expected test, zero skips, retries or failures. The OCR job is interrupted
while RUNNING with unfinished output and a live lease; exit 137 is recorded. It
completes on attempt 2 after the unchanged lease expiry. A deliberately lost
successful upload acknowledgement produces 0 visible retry interventions.
All 24 retained identities/artifacts and printing checks complete after recovery; zero
Inventory copies are written. The saved LP review, one unverified normal-control
example, one review event, 21 evidence bundles and independently downloaded
original SHA-256 remain unchanged. Reload restores review and all 24 cards.
Reused development printing recall is 24/24 first-ranked and 24/24 offered;
these figures are not independent accuracy or automatic-acceptance evidence.

After terminal cleanup, fresh checks conserve all seven source-table projections,
all nine substantive feedback-table projections (only account cleanup timestamps
excluded), and all 1,094 original identities, generations and stored SHA-256
bindings across 2,845,198,201 bytes. All exact-owner rows, the independent feedback
folder, and all 48 original/preview file bindings are absent. No active native
fixture work remains. All sixteen container identities/images/environments,
mounts and limits are conserved; fifteen retain exact start states. Only the OCR
start timestamp changes for the two documented deliberate kill/start probes.
The web image/source stays unchanged; test-only files need no application rebuild.

All three required CI checks pass on the implementation head. This final report
commit also requires current-head CI before readiness. Local private browser,
baseline/after, source-fence, fault-injection and residue reports retain evidence.
No hardware feeding, production operation, accuracy promotion, independent
labels, cohort rotation or original retention change is included. Broader
#692/#463/#310 acceptance stays open.
