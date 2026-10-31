# Exact decklist matching feedback — #844

Brian supplied the October 31 Commander League decklist and identified these
five failing entries: Shadowheart CLB146, Forest UST216 (eight copies), Plains
UST212 (four), Sol Ring SLC19 and Swamp UST214 (four). He confirmed the review
shows the duplicated “Exact set/collector number was not found” message, and
excluding those entries still produces an error with no cards saved on the
production installation. That production save failure remains unresolved.

The complete new fixture is `tests/fixtures/deck-paste-user-2026-10-31.txt`:
87 rows, 100 copies and one explicit foil annotation. It differs substantially
from the earlier October 21 sample; that sample's success is not a reproduction
of this report. Live public Scryfall set/collector lookups returned HTTP200 for
all 87 new entries, including the five named failures. Five returned canonical
names differ through double-face separators or the Newfound Adventure/Farseek
flavor name. No reference artwork was downloaded.

## Delivered behavior

The exact-printing resolver previously discarded the catalog result and mapped
both ambiguous matches and recognized printings outside the League's linked
inventory to NOT_FOUND. It also replaced catalog-service failures with that
same message. It now retains ambiguity/manual-selection guidance and real
catalog errors. A recognized printing outside the linked pool needs review and
explains how to choose a League printing or check linked locations. No automatic
substitution, pool exemption, basic-land exception or final-save rule changes.

Exact retries replace prior lookup errors and clear obsolete selections/counts
when unsuccessful. After linked inventory becomes available, successful retries
clear the old restriction message. The review displays identical feedback once
and gives it readable width inside the existing horizontally scrollable table.

## Validation and limits

- Focused importer and parser checks:16 pass, zero failures/skips. The final
  regression file can run against an untouched source tree with
  `DECK_IMPORT_SOURCE_ROOT`; its database reads and public API transport are
  controlled, while the real parser/importer/catalog client execute.
- Cumulative production candidate includes draft #984 correction durability and
  draft #985 review reload on main d6ce90e9. Initial image
  `sha256:a80dda7cd89ae855059bfcedec3c9241fcc7bc524e72a2b3dc604cba571e05f3`
  binds1,329 inputs, digest
  `6f6c31ac5a540ed3754bac2725bd65551e8326257ac4e1e979c45cb3c95187b4`.
- Real PostgreSQL and compiled browser checks at1366px/320px seeded the exact
  five printings in an unlinked control location and the other82 in the linked
  League pool. Review identifies exactly five restricted rows; excluding them
  saves the remaining82 copies. Relinking the five, resolving again and replacing
  the list saves all100 copies. Inventory, linked locations and audit rows remain
  unchanged by each import; each fixture restores all85 database tables exactly.
- Browser lookups use a finite loopback replay of all87 hash-verified public
  responses recorded October31; metadata and printing identities are real,
  while the users, League, inventory and database are disposable fixtures.
- The first browser harness passed the reported82-copy import but dismissed the
  later Replace confirmation and timed out. That failed run is retained. The
  corrected harness explicitly accepts only the expected fixture confirmation;
  both complete desktop/phone sequences pass.
- Visual inspection found duplicate messages and an excessively narrow status
  column; final presentation changes require the final image/browser readback.
  Required exact-head CI and final presentation qualification remain pending.

The controlled pool state demonstrates a misleading-feedback defect; it does
not establish the actual production inventory state or explain production's
final error. Keep #844 open. Production revision, sanitized server error and
incident-specific pool/deck state remain to be established. #808 remains a
separate ordinary-deck report. No production connection, mutation, deployment,
new issue, merge or reporter acceptance is claimed.
