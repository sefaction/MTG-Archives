# Search and deck-dialog consistency

This first site-optimization batch addresses #1039. Explicit Wishlist searches use
a native form: Enter and **Search local** run the same request, while the separate
Scryfall button retains its explicit scope. A pending request preserves input
focus and prevents duplicate submissions; failures leave a retryable search.

The owner Deck-library editor reuses `DeckWorkspaceDialog`. Native modal focus,
Tab/Shift+Tab containment, Escape and opener restoration now match the existing
deck tasks. Its Cancel, Close, Escape and backdrop dismissal compare actual form
values with the opening values and ask before discarding changes. Restored values
need no warning; unsaved tag-search text is not a stored edit. Successful saves
close normally, failed saves retain the draft, and dismissal is blocked during
the save. Other existing deck dialogs retain their previous backdrop policy.

Inside Inventory filter popups, Enter toggles a checkbox or keeps a live search
inside the popup. Escape dismisses the popup and restores its trigger before a
second Escape can dismiss the parent dialog. Quick-search suggestions similarly
consume Escape while open. These shared Inventory controls serve private and
Public browsing; public permissions and server mutation rules are unchanged.

`tests/ui/keyboard-consistency.spec.ts` exercises desktop, 390px and 320px search,
retry, modal focus/dismissal/save, conserved physical quantities and nested
Inventory popup handling. It requires the authorized local pilot environment;
`MTG_UI_WEB_CONTAINER` can select an owned isolated review container and
`PLAYWRIGHT_BASE_URL` its loopback URL. Original baseline failures are retained in
the owning worker's evidence. Ordinary textarea newlines, destructive actions,
League freeze/pool rules and explicit physical Inventory authority are preserved.

This is the interaction batch. Searchable large lists, browsing context and
measured backend read changes are separately reviewable follow-up batches under
Brian's approved optimization direction. Production deployment and individual
merge approval remain separate from source and local verification.
