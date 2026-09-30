# Unsaved corrections during batch actions

Issue #532 follows the browser draft implementation in #531. This batch is based
on #531 / #521 / #514 / #488, not the scanner stack. Individual approvals are
still required; cumulative local testing is not a merge or production deployment.

## Behavior

- An unsaved correction excludes that photo from bulk match confirmation and
  selection of saved reviews for Inventory. Clean cards stay available.
- Offscreen and filtered-out browser drafts count too. Presence protects a card
  even if the cached metadata is unreadable. Save or explicitly cancel the
  correction to make the card eligible again.
- Summary counts, filters, the Inventory shortcut and next-awaiting navigation
  treat uncommitted drafted cards as awaiting review. Committed cards stay added.
- The batch inventories browser keys once per account/batch mount, then tracks
  individual same-tab notifications and other-tab storage events. An explicit
  storage-clear event inventories again. Progress polling does not scan storage
  or mount every editor. The photo list retains its existing incremental rendering.
- Each write checks only its selected photo keys again, including after an async
  Inventory preview and before each bulk review save. Live dirty state protects
  edits when browser storage writes fail. This closes the gap between a rendered
  checkbox and a new draft that has not yet produced a rendered notification.
- If browser draft access cannot be established, fresh bulk/Inventory selection
  waits with recovery guidance. Individual server review saves still work.

## Authority and retries

Browser drafts are a local guard, not a server decision. Existing ownership,
review revisions, destination/capacity and preview-token checks remain unchanged.
A new Inventory addition requires clean selected reviews and explicit confirmation.

After a sent Inventory request loses its acknowledgement, its original payload
and request key stay fixed. A new browser draft or changed visible selection does
not replace that request. Recover it using Retry Inventory addition before changing
its destination or preparing another addition. This may recover an already committed
receipt; it is not confirmation of the newer correction. Saved originals, provenance
and seven-day committed-photo retention use the existing system.

This is not atomic locking across tabs or devices. Another tab may begin editing
after the final check or after a server operation has already completed. Existing
server revision checks protect saved decisions; browser metadata cannot reverse
an already completed Inventory addition. No recognition or native scanner changes.

## Evidence

The old loaded #531 build reproduced an enabled Inventory checkbox after editing
a saved review (owned local fixture). The first baseline run had a fixture cleanup
relation error; that fixture was explicitly cleaned and the corrected baseline
failed at the intended enabled-versus-disabled assertion. Both logs remain private;
the corrected baseline trace is preserved separately.

Six focused draft/display/navigation tests, typecheck and focused lint pass.
Disposable acquisition and shared import/receipt integrity checks pass with owned
cleanup. First controlled browser workflow passed1/1/27.9s; layout inspection
then found and fixed a misleading ready count for a dirty saved card.

Final source-verified Docker image1af4c3f6a9245a612c2936bf271e2fd61302ab88a10179612e7585ae3df8d9d6
has493 inputs/digest742a36306c968645b05edadd4c0018e44aae3459b32b3ea29156d1bf54bb920a.
Final browser run passed2/2/35.8s:14-photo draft actions24.4s and three-photo
fast corrections10.2s. It verifies offscreen/another-tab/reloaded drafts,
exclusions, edits after preview, eventless action-time cache races, Save/Cancel,
stale server preview rejection, actual owned Inventory commits, original-payload
lost-response retry with no duplicate, receipts/audit/provenance/digest/destination
and owned cleanup. Desktop1366 and phone320 layouts have no page-wide overflow;
screenshots were inspected. Final app1503c78 (cumulative1756d4d); PR #533.

Controlled suggestions and synthetic images are workflow evidence, not recognition
accuracy, independent physical cards or scanner qualification. No motor is needed.
