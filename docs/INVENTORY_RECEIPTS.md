# Shared Inventory receipts

`writeInventoryReceipt` writes quantity and its audit within the transaction
provided by the caller. CSV import and manual addition both use it. It performs
no network calls and never opens or commits a transaction independently.

## Facts and merge policy

Every receipt states owner, original opener (including explicit `null` when
unknown), exact printing, quantity, finish, condition, language, destination,
notes, source, pull and round. The source `ACQUISITION` is shown as **Scan** in
Inventory and is available in source filters. Existing opener values are kept by
the additive migration; no historical records are inferred or rewritten.

CSV/manual add-mode receipts may coalesce only when their normal attribute and
destination match also has identical source, notes, opener, pull and round.
Different facts create a separate stack. This corrects #454: adding copies used
to overwrite a prior stack's source/note and could attach unrelated new copies
to a legacy pull/round. CSV's separate-row option always creates separate stacks.
Normal compatible additions continue to coalesce.

Acquisition receipts require a new provenance lot. They cannot merge into a
pre-existing stack. The future acquisition commit layer may group explicitly
selected compatible physical candidates in one receipt. It must record unique
candidate membership separately; **this helper is not an idempotency service**.

The helper validates an exact positive PostgreSQL integer quantity, including
quantities greater than 999. The existing manual UI's 999 limit remains in its
caller. Incrementing a stack also checks integer overflow. Finish determines the
legacy foil boolean; no metadata or image analysis implies an opener.

## Transactions

The helper locks and rereads a matching existing row before incrementing it, so
concurrent read-committed manual adds record the actual before quantity. CSV
retains serializable atomic batch/receipt/audit behavior, with bounded retries for
Prisma conflicts and PostgreSQL 40001/40P01 returned from explicit row locks.
Audit failure aborts the surrounding transaction for creation and increments.

Authorization, eligible destinations, common capacity coordination, acquisition
request identity and immutable candidate membership are caller responsibilities.
No scan commit endpoint is enabled by this batch. Existing advisory capacity
semantics have not been changed.

## Verification

`npm run verify:acquisition` now also runs the shared receipt/import database
suite in its disposable local PostgreSQL container. CI's existing PostgreSQL
import gate runs the same fixtures. Coverage includes:

- 1,200-copy receipt without clamping; explicit unknown/known opener and pull/round;
- separate scan lots and unchanged originals across source/note/opener/pull/round
  differences;
- compatible CSV/manual additions, simultaneous receipts into new and existing
  stacks, exact before quantities in concurrent manual audits;
- failed audit creation/increment rollback, rejected invalid quantities;
- CSV retry, selected ready rows, unresolved conservation, ownership, destinations,
  reverse-order undo and later-edit undo refusal;
- nullable opener passed through a trade receipt without inventing one.

The owned Inventory browser case covers both legacy manual and scan rows, with
source filtering and preservation of unknown opener through edit/split/audit/
delete. Existing Imports acceptance checks CSV preview, commit and undo.

This is P7 receipt groundwork, not completed Acquisition commit. Fresh capacity
confirmation across every occupancy/layout writer, immutable reviewed membership,
selected-subset commit, seven-day committed-photo retention and actual Android
HTTPS acceptance remain separate required work.
