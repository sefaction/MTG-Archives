# Personal bulk cleanup

Brian approved this feature on November 25, 2026. It is personal and starts off.
Settings select the maximum copies per exact printing and whether copies in
decks count toward that maximum. Finish and language are separate groups. The
initial maximum is four and can be changed, including zero.

Physical inventory and complete, count-confirmed, current scan reviews share one
excess calculation. Saved inventory receipts are never counted again as pending
scans. Pending reviews across the owner's visible, uncancelled batches consume
the remaining allowance in original batch/card order. Only the batch being
viewed can be ignored by a scan cleanup action. Uncertain/unconfirmed recognition
does not authorize an excess ignore.

The scan action displays the original card number, printing, quantity and scan
thumbnail in physical order. The user pulls those cards and confirms **Pulled and
ignore selected**. Images, physical counts and saved review decisions remain;
ignored entries can use the existing Restore action. Candidates already saved
to Inventory must use Inventory cleanup. No scan is automatically ignored.

Card Hunt offers **Bulk cleanup** only when enabled. It groups eligible excess
copies by box/section, preferring to remove worse condition copies. Deck copies,
trade reservations, inactive/foreign storage and League provenance are protected.
The user confirms physically pulled copies before removing them from the
collection, giving/trading them through existing handoff history, or moving them
to a dedicated bulk/outgoing box. Such boxes retain physical Inventory and are
excluded from active cleanup counts while the cards remain there. Moving a card
back to ordinary storage makes it count again.

Plans change no data. Actions repeat current owner, policy, lot, reservation,
scan revision and physical-source checks. One confirmation applies atomically;
durable private receipts permit same-request recovery after a lost response.
History/audits preserve printing, quantities and provenance. Account settings
and counts never apply to someone else's collection, including in Admin Mode.

Delivery is an isolated feature branch and one PR. This approval does not include
merge, production deployment, physical scanning or business-data cleanup tests.

## Using the feature

In Settings, enable Personal bulk cleanup and save the maximum and deck choice.
Card Hunt then offers Bulk cleanup. Select physical copies from the listed
box/section, choose the action and confirm after pulling them. A dedicated bulk
box is ordinary tracked Inventory; its type keeps outgoing copies out of cleanup
counts. Give/trade uses the normal private handoff history as well as cleanup
history. No other user's inventory is a cleanup source.

For a scan batch, confirm the matches first. Excess scans shows a pull list in
original scan order. Save or discard local card corrections before selecting
those scans. The limit also counts confirmed cards waiting in your other batches,
but Ignore selected affects this batch alone. Ignored cards retain Restore.
An unresolved confirmation must use Check same confirmation before another
cleanup can begin in that tab. Plans are paged in groups of 100 entries; changing
pages clears the selection and confirmation only applies to selected entries.

## Upgrade and verification

The additive personal-bulk-cleanup migration runs through the normal web startup
and ordinary Unraid stop/pull/start workflow. No Compose, environment, model or
worker change is required. Existing accounts remain opted out. Retain the new
receipt table and settings when rolling back the application; do not delete
action history or run a down migration to roll back the UI.

`tests/bulk-cleanup.test.ts` covers input and recovery binding. The disposable
PostgreSQL verifier `scripts/verify-bulk-cleanup.ts --run` requires
`MTG_BULK_CLEANUP_TEST=1` and exactly `mtg-bulk-cleanup-db/bulk_cleanup_fixture`;
the existing CI database job provisions that isolated target. It never connects
to an installed collection. Private local browser/recovery artifacts stay outside
tracked source and are summarized in the PR.
