# Deck builder workspace

First implementation batch for #268. The existing deck routes, data model and mutations are retained.

| Capability | Home | Scope |
| --- | --- | --- |
| Deck identity, format, bracket, visibility and essential copy totals | Compact builder header | Existing owner/public/League policy |
| Banner art, description, tags, detailed coverage/value and section totals | Expandable Deck details, art & coverage | Existing presentation retained |
| Add exact printing, commander or section; optional physical-copy workflow | Direct Add card dialog | Editable decks only; League search restrictions retained |
| Paste and review decklist | Direct Paste decklist link to existing import route | Existing management/locked-deck guards |
| Return all commitments, settings, banner editing, safe delete | Deck options dialog | Existing forms and confirmation rules |
| All card views, grouping, sorting, row details and printing/commitment editing | Builder toolbar and card list | Public viewers retain browsing only |
| Select all/current/missing/unowned, optimize subsets | Selection & printing tools dialog | Selection shortcuts available before selecting; mutations only after selection |
| Selected move/remove/return/printing preview | Same dialog, shown only with selection | Existing server operations and confirmations |
| Analysis, Sample Hands, Playtest | Shared Deck tools navigation; Back to deck on each tool | Same deck context, including public and League; sandbox remains device-local |
| Folders, tags, bracket filters, library views and creation | Existing Decks library | Unchanged in this batch |

Native dialogs contain keyboard focus, restore the opener on close/Escape and scroll within the viewport. Common tasks need no dropdown. The old unbounded action/selection menus are removed. Detailed art and statistics remain available without preceding the working card list on initial load.

## Verification and remaining scope

The pre-change 1366×768 baseline placed the builder at y=629, leaving only the start of card content at the screen edge. The same deck now starts its builder at y=350. Current verification results and review image/commit belong in WORK_CHECKPOINT.md and LOCAL_REVIEW_BUILD.md.

The new disposable browser fixture checks actual Add card persistence without physical inventory changes, empty and populated decks, all card views, selection-only actions, keyboard focus/Escape, options/delete reachability without deletion, import/tool return links, anonymous public/private boundaries, four viewport widths, six themes and enlarged text. A second fixture cancels whole-deck return and verifies that returning selected committed copies conserves four physical copies while preserving the four-card deck list. Full regression passed 49/49, including pasted import, League lifecycle, analysis/hands/playtest, inventory and storage; both Decks fixtures passed again after final CSS polish.

This batch does not complete #268. Library layout/organization polish and regrouping frequent versus advanced playtest tools remain follow-up work. It does not add persistence for builder view/sort selection across route navigation, alter sandbox saves or claim to resolve #220/#260/#280.
