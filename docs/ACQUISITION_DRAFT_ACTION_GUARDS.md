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

Four focused draft tests, typecheck and focused lint pass. Disposable acquisition
and shared import/receipt integrity checks pass with owned cleanup. Cumulative
Docker build and the 14-photo controlled browser workflow are being qualified;
record the final source identity, UI result and limits before calling this ready.
Controlled suggestions and synthetic images are workflow evidence, not recognition
accuracy, independent physical cards or scanner qualification. No motor is needed.
