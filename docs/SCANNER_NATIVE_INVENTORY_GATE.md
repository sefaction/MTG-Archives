# Windows helper fixture through successive scanner batches and Inventory

This is a local software acceptance gate for #501, #506, #308 and #309. The
installed Windows helper (0.3.8, protocol 0.3.0-native) uses its existing guarded
fixture-server command: MTG_LOCAL_PILOT_TEST=1, explicit loopback connection and
ScannerFixtureBackend. It never creates NAPS2, discovers hardware, opens a driver
window or operates a motor. The retained fi-7160 Blessing PNG is copied byte for
byte. Its expected title is only a test assertion; it is not passed to recognition.

The existing gate still defaults to Sunblade Samurai for its original corpus.
An optional expected-name variable allows a known preserved development scan to
exercise the same scanner boundary without recapturing or rewriting an image.
Ordinary UI actions have a15-second bound; native processing remains bounded by
its original10-minute printing allowance and15-minute total test timeout.

The gate now creates two spaces in its owned fixture section. Batch1 follows
website Start, actual helper delivery, ordinary OCR/visual/catalog/printing,
bulk review, refresh and explicit Inventory preview/final confirmation. It checks
zero Inventory before confirmation, one resulting copy and one acquisition audit,
location/section/NM/nonfoil, original bytes and desktop1366px/phone320px overflow.

The test stops and restarts ONLY its fixture server on the same saved connection.
New scanner batch must retain destination, section, source, settings and defaults
without repeated entry. Batch2 reaches ordinary printing and survives refresh;
both distinct runs and photo identities retain the original byte digest. Batch1's
saved review/revision, Inventory row and acquisition audit remain unchanged.
Batch2 never commits Inventory. Finally stops the owned helper, forgets only its
new fixture credential/connection, removes its UUID-bounded spool, and removes its
owned database/session/photo/Inventory records. Existing helper services stay intact.

## Evidence and limits

The original one-batch gate PASSED in2.2minutes, zero skips. An authoring syntax
error occurred before launching a helper; its log is preserved separately.
The first extended run FAILED because its new assertion expected a destination
search combobox. The selected destination is intentionally collapsed; the failure
snapshot proves correct retained destination/section and1/2 occupancy. No app fix
was needed. The corrected gate checks visible selected destination, its hidden
location identity and the pressed section, and PASSED in2.7minutes, zero skips.
Both failure artifacts and the successful result remain private under.local-data.
A final run additionally verifies stored original bytes for BOTH runs after the
helper restart; its result is recorded when complete.

This reused input is not an independent printing-accuracy trial, physical feeder
qualification, USB/driver crash recovery, fresh-machine installation acceptance,
production acceptance or100/300 throughput qualification. The failed100 native
printing gate remains failed. This test-only branch changes no application build
input, scanner runtime, recognition policy, queue fairness or Inventory authority.
The existing cumulative local image/source digest remains the navigation build.
Final qualification PASSED1/1, zero skips, in2.5minutes with both stored original
byte checks after the helper restart. Both runs and originals remain distinct;
only batch1 produced an explicit one-copy commit/audit. Phone screenshot inspection
passed. Final typecheck and exact510-source local image comparison passed.
After owned cleanup, zero fixture users/agents/helper servers remain; original
10280 Inventory rows/12482 copies,81 saved reviews and907 photo identity/digest
hashes match the start-of-night baseline exactly. All private original single,
assertion-failed, corrected-successive and final byte-verification reports are
retained separately. No production access/change, physical feed or merge occurred.
