# Scan batch review

Open **Imports → Scan cards**, start or resume a batch, and set the batch finish
and condition. **Simple** is the default review mode; the browser remembers your
choice for your account.

## Simple

- Compare your scan with the proposed printing, including set and collector number.
- **Confirm match** saves the proposed printing with the displayed attributes.
- **Correct**, or the proposed image, opens printing alternatives, search and
  per-card attributes. Save the review or cancel the changes.
- Filter the batch by All, Awaiting review, Ready for Inventory or Added.
  Counts describe the entire batch, not only the rows currently shown.
- More rows load as you scroll; Load more cards is also available.

Stamp uncertainty and failed checks remain visible. A suggestion is not proof of
an exact printing. No retrieval score is presented as an accuracy percentage.

## Advanced

Advanced retains the original/crop/reading-zone views and detailed OCR, image,
printing, stamp and catalog evidence. The saved reading-zone overlay shows the
strips actually attempted by that worker result; old results retain old zones.
Open original photo is available in both modes.

Mode changes and background updates preserve unsaved corrections. Rows with
unsaved edits stay visible if a filter would otherwise remove them. Saving or
cancelling clears that draft. Switching to another batch is separate from a mode
change; save your current corrections first.

## Inventory is separate

Confirming a match saves review only. Use the Inventory confirmation controls to
select reviewed copies, choose a destination/section and explicitly add them.
Ownership, capacity, revisions and duplicate-safe commit rules still apply.

This UI slice belongs to #308 and the expanded #463 goal. It does not establish
recognition accuracy or complete either phase.
