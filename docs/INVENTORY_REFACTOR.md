# MTG Inventory Refactor Notes

## 1. Existing architecture summary

This repository is a Dockerized Next.js App Router application written in TypeScript. It uses PostgreSQL through Prisma, Tailwind CSS for styling, local username/password authentication, server actions for mutations, and Scryfall-backed card metadata. Inventory rows reference shared `Card` records and record changes in `InventoryAuditLog`. CSV import preview and resolution history is retained through `ImportBatch`, `ImportBatchItem`, and `ImportResolutionAttempt`. Trades use `Trade` and `TradeEvent` records with card snapshots and a two-party physical exchange confirmation workflow.

## 2. Legacy feature removal status

- Visible navigation for legacy owner/admin setup, collection-opening workflows, deck placeholders, wishlist placeholders, stats placeholders, grouped intake periods, points, sealed-product setup, and allocation tools was removed.
- Legacy placeholder pages/components that did not support inventory management were deleted.
- The admin screen was reduced to user management and operational counts instead of event or sealed-product setup.
- The dashboard was replaced with inventory and trade statistics.
- Seed behavior no longer creates demo people, event structures, sealed-product setup, point data, source-demo records, or sample trades.
- Trading no longer depends on event windows, per-opponent event limits, or event eligibility checks.

## 3. Inventory and trading systems retained

- Local authentication, admin-created accounts, roles, and forced password changes.
- Scryfall card lookup and card metadata persistence.
- Inventory search, filtering, table/image views, admin editing, export, zero-quantity cleanup, and audit trails.
- CSV import preview, matching, manual resolution, retry, maintenance, and commit workflow.
- One-for-one trade proposals, acceptance, decline, cancellation, physical confirmation, completion events, card snapshots, and inventory audit logs.

## 4. Remaining legacy models and why they remain

`League`, `Season`, `Round`, `LeaguePlayer`, `SetBox`, `PackAllocation`, `PointCategory`, `PointEvent`, `Pull`, `Player`, and `CardOwnership` remain in the Prisma schema as legacy compatibility tables so existing databases can migrate safely and so historical inventory/import/trade references are not broken. `Player` is still the internal ownership table for `InventoryItem` and `Trade` because fully moving these relationships to `User` requires a larger data migration and broad authorization rewrite.

Legacy source-group fields are nullable and hidden from normal inventory, import, export, and trade screens. New imports and trades write current source metadata (`sourceType`, import batch records, trade events, and audit logs) rather than asking users for legacy source groups.

## 5. Recommended target ownership data model

Move inventory ownership directly to `User`:

- Add `InventoryItem.ownerUserId` and `InventoryItem.originalOwnerUserId`.
- Backfill from `User.playerId` where possible.
- Create a clear conflict-resolution report for inventory owned by a `Player` with no linked active user.
- Update import, export, inventory editing, audit display, and trade authorization to use users directly.
- Remove or archive `Player` only after all inventory/trade/import references have been migrated.

## 6. Recommended target trade data model

Replace the current one-offered-row/one-requested-row shape with line tables:

- `Trade.proposerUserId`, `Trade.recipientUserId`, status timestamps, notes, and optional admin correction fields.
- `TradeLine` with `tradeId`, `side`, `inventoryItemId`, `quantity`, and immutable snapshot JSON.
- Optional requested side lines so cards can be offered with no requested cards.
- Optional non-payment cash/value balancing metadata fields, without payment processing.
- Event and audit logs linked to both trade and affected inventory rows.

## 7. Staged migration plan for removing legacy compatibility dependencies

1. Keep nullable legacy source-group fields while validating fresh installs and existing imports/trades.
2. Add user-owned inventory and trade columns beside current player-owned columns.
3. Backfill ownership and generate a report for ambiguous or orphaned `Player` records.
4. Update all reads/writes and authorization checks to use `User` ownership.
5. Add trade line tables and migrate existing one-for-one trades into two line rows.
6. Keep legacy owner/source fields only in audit/history compatibility paths until they can be archived safely.
7. In a later major migration, archive or drop legacy compatibility tables after backups and production verification.

## 8. Inventory-transfer and data-migration risks

- Merging rows must preserve card printing, foil treatment, condition, language, notes where relevant, and current source/audit history.
- Rows with zero quantity should be removed, but audit trails should keep enough before/after JSON to explain the transfer.
- Completed trades must be idempotent; a retry must not transfer inventory twice.
- Legacy `Player` records with no linked user can block direct user ownership migration.
- Nullable legacy source-group fields mean old compound uniqueness rules are not sufficient for all future merge behavior; application code must match on all current distinguishing attributes.

## 9. Recommended next Codex task

Implement the direct `User` ownership migration: add user ownership columns to inventory/import/trade models, backfill from `User.playerId`, update authorization and UI terminology, add migration verification scripts, and keep `Player` as a read-only compatibility bridge until all legacy data is accounted for.
