# Inventory Locations and Grouped Views

This pass adds first-class storage locations while preserving the existing inventory-row model. Each `InventoryItem` still represents a concrete owned printing and attribute set, and now also points at an optional `InventoryLocation`. The UI and service layer aggregate those rows for display.

## Data model

- `InventoryLocation` is scoped to an owner (`Player` in the current internal schema) and stores a user-defined name, normalized name, optional description/type, active flag, and timestamps.
- `InventoryItem.locationId` links a row to the location that contains that row's quantity.
- Location names are unique per owner after whitespace/case normalization, so two users may both have `Box-0001`.

## Existing inventory migration

The migration creates an `Unassigned` location for every owner that already has inventory and assigns each existing inventory row to that location. It does not merge inventory rows or change existing quantities, card printings, finishes, conditions, languages, owners, or audit history.

## Display modes

The inventory page has two display modes:

- **Exact printings** groups rows that share owner, local card printing, finish, condition, and language. Quantities are summed across locations and the row exposes a location breakdown.
- **Grouped by card name** groups exact-printing rows by Scryfall `oracleId` when available and falls back to normalized card name when it is missing. This is display-only and does not merge database records.

## Import and export behavior

CSV import parsing recognizes a `Location` column and preserves the original imported location on the parsed row. During commit, the selected destination location is used by default; an imported location name is used only when that location already exists for the owner. Missing imported locations are not created automatically in this pass.

Inventory exports include the location name in the full CSV and add a location tag in Moxfield-format exports.

## Trade behavior

Trades continue to transfer from the selected inventory row. Because rows now carry `locationId`, trading out subtracts from that source location. Received trade cards are assigned to the recipient's default `Unassigned` location unless a matching destination row already exists there.

## Remaining limitations

- The current storage model uses one inventory row per location rather than a separate child quantity table. This is safer for the first migration, but a future refactor can split quantities into `InventoryLocationQuantity` records.
- The inventory page displays exact multi-location totals and grouped card totals, but moving quantities between locations is currently available through service code and admin row edits rather than a dedicated end-user drawer control.
- Trade proposal UI does not yet let the recipient choose a destination location; received cards default to `Unassigned`.

## Bulk moves and scalable browsing

The inventory browser now includes a bulk toolbar in **Exact printings** mode. Users can select individual rows, select visible/loaded rows, or select all rows matching the current server-rendered filters, then move those records to a destination location. The server reuses the active filter closure for all-matching moves and validates the destination owner before applying changes.

The Locations page includes a full-location move workflow for operations such as moving every card from `Unassigned` to `Box-0001`. The operation requires confirmation, validates source and destination ownership, merges matching destination rows, deletes merged source rows, and writes inventory audit logs.

Inventory browsing now defaults to a 50-row page size and supports 10, 25, 50, 100, and 250 row pages. An optional Infinite scroll browsing mode increases the number of client-rendered rows as the user scrolls. This first pass still builds exact/grouped totals from the server-rendered result set so exact multi-location totals remain correct; a future pass should move the list endpoint to database-level cursor pagination for very large inventories.
