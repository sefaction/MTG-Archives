# Commander League paste: connection bursts and review feedback — #844

Brian supplied a new list with 87 entries representing 100 cards decklist on October 31 and named five
NOT_FOUND entries: Shadowheart CLB 146, Forest UST 216 (8), Plains UST 212 (4),
Sol Ring SLC 19 and Swamp UST 214 (4). Excluding those entries still errored with
nothing added on production. His screenshot shows the app’s generic error
boundary without a reference. This report remains separate from ordinary-deck
physical-copy incident #808.

## Observed production failure

After explicit, separate read-only approvals for the existing production app
and MTG container logs, the web log showed `prisma.inventoryItem.findFirst()`
failing with P2037: “Too many database connections opened: FATAL: sorry, too many
clients already.” Subsequent session/deck-import-page reads report P1001, unable
to connect to PostgreSQL. The browser retains only the redacted Server Components
render error. No import was replayed, and no production data, settings, commands,
container lifecycle or deployment was changed. The temporary log viewer was closed.

The log viewer has no per-entry timestamps. These are observed production errors;
the exact timing and complete server connection budget are not established.

## Repair

Final League validation previously launched one inventory query per selected
printing with Promise.all. It now groups all distinct requested card IDs in one
query. The existing positive-stock/linked-League predicate, exact-printing rules,
returned stale-pool error and atomic import transaction are unchanged. Duplicate
entries still need only printing availability; no basic-land exception or silent
substitution is introduced.

Exact lookup also discarded useful outcomes. Recognized printings outside the
linked pool, ambiguous matches and catalog errors all became NOT_FOUND. These
now retain distinct explanations. Exact retries clear obsolete errors/selections,
and identical feedback appears once at a readable width.

Unexpected save exceptions retain the pasted text/review/selections. The message
says the import could not be confirmed, preserves only a bounded numeric reference
and tells the user to check the deck before retrying. A reply can be lost after
a successful commit, so no automatic retry or assertion of zero writes is made.

## Regression evidence

- 40 focused importer/parser/actual-save-handler/actual-final-gate checks pass.
 The unchanged exact resolver fails 10 intended cases (3 controls pass); the old
 save handler fails 3 exception cases (7 controls pass). The actual old final
 League branch fails the one-query-slot control (3 other controls pass).
- Real compiled pressure comparison uses the supplied 82 included rows, the same
 20-connection PostgreSQL limit, app pool limit 16 and eight known peer connections.
 Both controls measure 16 clients including the observation connection before
 saving. The unchanged importer reproduces P2037 with zero deck writes. The
 batched importer saves all 82 copies without P2037 under identical pressure.
- Under pressure, removing one reviewed printing rejects the whole import without
 deck writes and retains review. Restoring it permits the same reviewed import.
 Pool/Inventory/audits remain unchanged by imports; both completed pressure
 controls restore all 85 database-table fingerprints exactly.
- Final compiled desktop (1366px) and phone (320px) normal cases save 82 copies after the exact five
 exclusions and 100 after relink/retry/replace. Four before-write/after-commit
 reply-loss cases retain review, preserve correct quantities and never retry
 automatically. Each completed case restores all 85 tables. Desktop/phone feedback
 layouts are inspected; identical text appears once and the status column is
 at least 192px wide inside the existing scrollable table.
- All 87 live public Scryfall set/collector endpoints returned200. Browser fixtures
 use finite replay of those hash-verified records; users, League and inventory
 are disposable. The metadata recorder fetched no artwork. The October 21 sample
 differs substantially and its earlier success is not incident reproduction.

## Source binding and retained failures

The compiled cumulative candidate includes main 59275d70, unchanged drafts #984/#985
application files, and this backend/UI repair. Source 0a5867d4, image
`sha256:3d6de06c2a3c1a2818d9c003b6168e7b15a71f2cc6848e0013b6f9fd6cd086fc`,
1,335 inputs, digest
`ca586f3c0247b28b8f3f67d5e31c22385ee8f7911a892de302043da958000c5d`.
The additional actual-branch MJS regression and documentation are later
non-application inputs; all tested application files match this PR. Required
exact-final-head hosted build/tests and readiness are recorded on the live PR.
Earlier source-head checks do not substitute for them.

The old pressure-control image is
`sha256:39d2439f0982e2825463c6fd90ccd1c9a462ea9b03037a6e49af22ad0e9fcd6d`
(source 0db17931; 1,334 inputs, digest prefix 634eb17c). Earlier initial/reload qualification
remains bound to its recorded source and manifests.

Retained failed harness intervals include dismissed Replace confirmation,
ambiguous route-announcer/form alert selection, missing SQL helper export,
initial 14-peer budget refusal, detached holder module path/cleanup failure,
and startup readiness/early-exit problems. The failed synthetic holder stack was
fingerprinted and retired after its interrupted cleanup; it is not claimed as
85-table restoration. Corrected controls complete with exact conservation.
Original four stopped containers and all four volumes remain unchanged; owned
containers/networks are retired and the exact runtime claim is released.

Keep #844 open until the approved resolving merge, named-installation delivery
and reporter validation. Production’s exact five-printing pool state still needs
verification. This removes the demonstrated import connection burst; deployment
and any broader server connection-budget work remain separately authorized work.
