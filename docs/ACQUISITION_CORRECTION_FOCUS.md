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
Changed-input local production build, repaired browser matrix, source binding,
required final-head CI and independent review are pending at initial commit.
Keep #916 and broad #308 open; individual merge approval, installation and user
acceptance remain separate. No production, schedule or physical scanner action.
