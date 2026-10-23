# Correction discard keyboard focus

Issue [#916](https://github.com/sefaction/MTG-Archives/issues/916) is a narrow
keyboard/focus remainder of [#308](https://github.com/sefaction/MTG-Archives/issues/308).
Keyboard-activating Cancel changes disables and then removes its focused button.
The existing editor did not restore focus after successful discard. An actual
Simple1366px production-client case fails its Correct-focus assertion after
discarding; all84 original public-table row fingerprints match after cleanup.

The client now schedules focus only after a successful discard and waits for
replacement controls to be enabled. Simple returns to Correct; Advanced returns
to the persistent Card name input. Focus deliberately moved outside this card
is left alone. Failed discard, polling and mode changes do not schedule focus.
Review APIs, decision/draft semantics and Inventory authority are unchanged.

The opt-in `tests/ui/acquisition-correction-focus.spec.ts` requires an immutable
local review container, explicit review database, loopback URL and configured
acquisition storage. It creates a disposable account/photo and establishes one
saved review through the real writer. It exercises a failed discard, successful
keyboard discard and next keyboard action, then a delayed discard while focus
moves outside the card. It requires exact saved-candidate/event/Inventory/commit
conservation, no additional decision POST, original photo bytes and full84-table
fingerprints after exact owned cleanup. Simple/Advanced at1366/320px are covered.
Only one selected GET failure and response timing are adapted. Short-lived
fixture sessions and unclaimed failed fixture jobs do not qualify password login,
native recognition or physical scanner operation.

An initial harness used an Inventory-only preview with no acquisition storage.
The failed upload and cleanup are retained. Its exact synthetic graph was
verified and removed; no photo was published, but no persisted full-table before
snapshot existed for that first attempt. The corrected harness checks storage
before mutations, saves both snapshots and preserves primary and cleanup errors.
That setup failure is not the product negative or a conservation pass.

Eight existing draft/navigation/display checks and changed-file lint pass.
All four repaired Simple/Advanced1366/320px cases pass in32.6seconds, including
the failed-read/draft control, next keyboard action and outside-focus delay.
Every case conserves its exact saved candidate/events/Inventory/commits, makes
no additional decision POST, retains the original photo bytes, and restores all
84 table fingerprints after cleanup. Desktop/phone screenshots were inspected.

The local production image at product/test `95a67040` passes compilation, types,
static generation and client manifests. Its actual embedded manifest equals all
1,227 expected declared inputs, digest
`33560fff8c8e943cefe7430864b5556dae2a701f074ce4fbabbd2be081074685`.
Image `57a6536dc48b61f88612f57dc9c31dc388b3b4ab891f7961930dfbf796fee4b1`
was reviewed on loopback13017, with isolated acquisition storage and database
`review905_01a16522`. This candidate includes main04b49133 and this focus repair;
it does not claim subsequent main changes or production installation.

The explicitly bounded recipe uses a2GiB/no-extra-swap/oneCPU builder and1536MiB
JavaScript heap. It skips duplicate concurrent local lint; separate changed-file
lint and canonical exact-head CI cover it. Build memory events record zero OOM
kills. The owned builder and3.835GBcache were retired after preserving identity,
logs, memory counters and cache manifest. This is declared-source equality,
not a whole-context or reproducible-binary claim. No unchanged-input rebuild is
needed for subsequent documentation-only updates.

All seven product/test-head jobs passed Verify39978359486. Independent source
and original-negative review found no actionable finding; final available
runtime/evidence binding and required final-head CI are tracked on
[PR #917](https://github.com/sefaction/MTG-Archives/pull/917). Original failing
attempts are retained. The first runtime-claim release was rejected by automatic
approval review while the temporary baseline container was live; its zero owned
files and exact identity were verified, it stopped normally, and the claim then
released through the supported exact-owner path. No resource lock was bypassed.

Keep #916 and broad #308 open; individual merge approval, installation and user
acceptance remain separate. No production, schedule or physical scanner action.
