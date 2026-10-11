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

Current qualification is incomplete: types, actual local source/image checks,
full 24-original native/browser run, cleanup/data/service/photo integrity and
final-head CI must be recorded before this draft becomes ready. No hardware
feeding, production operation, accuracy promotion, independent labels, cohort
rotation or original retention change is included. Broader #692/#463/#310
acceptance stays open.
