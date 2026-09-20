# Advanced manual playtest

Issues #167 / #162 and #222. Device-local tabletop only; no rules engine, networking, server game saves, or mutations to saved decks/inventory.

## Controls

- Library search matches the complete library before limiting the displayed, alphabetized results to 50. Narrow the query to find other matches.
- Select cards with checkboxes, then move the selection or shuffle it into the library. One bulk operation is one undo step.
- Battlefield layout can be a wrapping grid, sorted group labels, or a scrollable free-position tabletop. Drag in free layout, use arrow keys on a focused card, or adjust X/Y sliders in Edit details. Card size is adjustable. Layout and size are view preferences for this visit; positions/group labels are game state.
- Edit details adds named counters, independent manual P/T modifiers, group labels and temporary copies. Tokens use a custom label. Token/copy badges distinguish them from deck cards; only temporary cards can be removed outright. Neither counters nor damage apply automatic rules.
- Scry, surveil and reveal-top inspect a fixed set of up to 50 cards; rearrange top/bottom, or put surveilled cards in the graveyard. Moving one does not reveal a replacement. Displayed order follows the actual library, top first. Close the tool when finished. Coin/dice results are seeded, reproducible and undoable, not cryptographic randomness.
- Add up to seven named player panels with life and per-commander damage. A Me panel can track damage received. Damage does not also subtract life or declare a loss. The main life counter remains separate.

## Persistence contract

- Browser key scopes saves to viewer and deck, including a separate anonymous identity. No remote writes occur. Device storage and downloaded files may expose private deck names to someone with access to the device; clear them on shared machines.
- Version 1 files are limited to 1 MB, 1,000 total runtime cards, bounded strings/numbers/counters/player panels, and strict object shapes. History is bounded to 100 actions and is not exported.
- Files contain deck-entry references and runtime annotations, not arbitrary card metadata or image URLs. Restore reconstructs cards from the currently authorized snapshot, validates unique instances, and requires every original deck card exactly once. Temporary IDs and commander tax sources are validated too.
- A deck signature covers entry identity, name, printing, quantity, section and commander designation. A changed/different deck produces a visible refusal, leaves the old save untouched and pauses autosave. No silent partial restore. Clear or explicitly resume saving to replace a stale save.
- Clear saved session removes that viewer/deck key and restarts locally with saving paused. Explicit resume re-enables saving. Imported valid files are undoable; if saving is active, they replace the current device save. Invalid files do not change game state.
- Metadata-only updates to a printing use current authorized metadata; they do not require stale-save rejection. No deck data is loaded from another user or server by an imported file.

## Verification

Reducer/storage tests cover full-library matching, bulk order/card conservation, same-library reordering, temporary copies/tokens, counters, P/T, positions, players/damage, deterministic random tools, history/runtime bounds, round trips, stale signatures, malformed/oversized/duplicate/missing/injected files and viewer key separation.

Opt-in `tests/ui/playtest-advanced.spec.ts` creates a unique private 80-card fixture and cleans it up. It searches a known card initially beyond index 50, exercises advanced controls, exports/restores, rejects malformed and changed-deck state, checks responsive layouts/private access and asserts no browser writes after entering the sandbox. Existing core playtest tests now verify device restoration and clear-session behavior. Exact final build/test evidence belongs in the PR and WORK_CHECKPOINT.md.
