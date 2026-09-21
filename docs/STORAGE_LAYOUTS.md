# Configurable storage layouts

Review follow-up #286, stacked on the browse-first Locations PR #284. Separate merge approval is required. Local Docker is cumulative; exact revisions and verification are in WORK_CHECKPOINT.md.

## User decisions

- Location types is a peer view alongside Storage and Deck locations.
- Search updates after a short typing pause; space, type and active/inactive filters compose before paging and preserve URL context.
- Type defaults provide assumed section names/capacities. New locations copy those defaults; each location can customize them independently. Later type-default changes do not rewrite existing locations.
- Capacity is advisory. Full or over-capacity storage warns but never blocks a move/import. Unknown capacity does not match Space remaining.
- Creation is a three-step Basics / Storage / Review wizard. No tracking, one capacity, or generated/customized sections are supported; sectioned storage may also have an overall capacity. The final Create action is explicit and separate from Continue.

## Persistence and compatibility

Nullable JSON fields `LocationType.defaultStorageLayout` and `InventoryLocation.storageLayout` hold validated `{capacity, sections: [{name, capacity}]}` data. A missing legacy location layout retains prior behavior: Vault has Sect 0–5 at 85 each, other types have no assumed capacity. Explicit layouts replace defaults, not inventory assignments. Type-default edits affect only future creation, including when a type's existing locations still have null layouts.

Capacities are null (unknown) or positive PostgreSQL-sized integers. At most 100 default sections, unique case-insensitive trimmed names of 1–100 characters. Section matching remains exact and case-sensitive for actual placements. Renaming/removing a default never renames, deletes or moves inventory; old arbitrary labels remain visible as unconfigured placements. Counts use direct physical copies, not printings or descendants.

Available space sums nonnegative remaining capacity in configured sections and, if present, caps it by overall remaining capacity. With only overall capacity it uses all direct copies, including arbitrary/unsectioned placements. With no known capacity it is unknown. Full filtering means known remaining space is zero, including over-capacity locations. Empty means no direct physical copies, not necessarily an empty descendant tree. Active/inactive is a separate filter.

## Boundaries and safety

Owner/admin scope, reserved Deck behavior, existing visibility rules and confirmations remain. Only a type's creator or an active administrator can edit its defaults; any user can customize their own location. Creation, a newly created type's defaults, and the location audit share a transaction. Type deletion retains its existing ownership/replacement policy. Capacity settings do not add write-time enforcement to inventory services.

The shared storage summary feeds Locations, Inventory and import/manual-add destination pickers. Overall move previews are upper bounds for mixed selections; movements within the same location may add fewer physical copies. Fill remaining space uses the tighter known location/selected-section bound. All-matching selections keep the existing conservative preview and final server-side revalidation.

Browser coverage includes reusable type creation/editing, independent snapshots, legacy placement preservation, live filter composition, advisory overfill moves, wizard Back/Review and responsive layouts; prior lifecycle/scale/vault tests remain active. The first browser run caught an unintended Continue-to-submit transition, corrected by distinct button identity and explicit default prevention; regression coverage verifies Review before creation. Test-label/status ambiguities were corrected without increasing timeouts. See checkpoint/PR for final results rather than treating this document as a passing-test claim.

Inherited #283/#220/#260/#280 are separate and remain unresolved. No production deployment or placement backfill.
