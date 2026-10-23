# Capacity handoff and same-session reassignment qualification

This covers the recorded #309/#308 capacity handoff and same-session reassignment
requirements, integrating main932e305c. The earlier main3b06f208 qualification is
preserved below with its original limits.
The batch adds a browser verifier and evidence/map only. Application services,
permission, quantity, capacity policy, receipt format and transaction bounds are
unchanged. It does not close either broad phase.

## Actual workflow

Each1366/320px case starts with537 stored copies and800 capacity. One actual
authenticated upload/review supplies the template for262 explicit persisted
fixture copies, each with a distinct slot/photo/candidate/artifact/observation
identity and its own original file. This controls the reviewed input state; it
does not claim263 actual provider acknowledgements, human reviews or native
recognition. Processing workers are absent; optional previews are not invented.

The real browser/API initially previews263 copies with no overfill. A separate
fixture database write adds five stored copies, exercising the real capacity
revision triggers. The old final confirmation returns409, leaving542 stored
copies and zero acquisition receipts, memberships or audits. A new preview must
show five excess copies and disable confirmation without fresh consent.

Two alternatives are tested independently at both widths:

- Deselect five visible physical cards, preview/commit258, verify exactly258
  memberships and one258-copy audit, then reload. The five retain their reviews
  and stay uncommitted. Preview them at the full original destination, then
  propose the five-space alternative destination with no overfill. Changing or
  previewing the destination must not consume them or alter800 total stock.
  Separately confirm adding those five there: original location remains800,
  alternative location has5, total stock805. Two receipts contain258and5 unique
  memberships (263total), with two exact audits and no new overfill. The complete
  first receipt/members, original-location stock and first audit remain unchanged.
  Replay the frozen actual five-card request: same receipt/replay true and no
  ledger mutation. Reload shows263added, no five-pending action, all263committed
  and the same full ledger. The completion state can be scrolled into view.
- Preview263 again, supply the physical-space acknowledgement and reason, then
  commit263. Verify805 total stock,263 memberships, one audit with overfill5 and
  the exact entered reason, and committed status after reload. A reason alone
  must leave the final action disabled.

Every case compares all263 original byte hashes, photo identity/readiness fields
and complete candidate rows before/after. No saved review is rewritten by the
handoff. All85 public-table counts/full-row hashes match the original migrated
baseline after exact fixture cleanup. The new alternate-destination addition is
an actual separate UI/API commit, not a preview-only claim.

## Binding and results

`tests/ui/acquisition-capacity-handoff.spec.ts` passes all four extended cases in
59.4seconds. After adding the ordinary completion scroll/viewport guard, both
affected subset layouts pass again in36.5seconds. The unchanged overfill paths
reuse their applicable first-run results; no original assertion or deadline is
weakened. All six current-schema cleanup pairs conserve85tables.
There is one browser worker,15-second action bounds and a180-second case bound.
Horizontal-overflow guards pass and desktop/phone evidence is visually reviewed.
The new test uses explicit immutable container/database environment guards and
local loopback only. It is opt-in, not a new automatic heavy CI browser job.

The fresh disposable web/database/network use640/384MiB, oneCPU each and no extra
swap, under measured VM/host/disk admission. They reuse qualified image4b5ffc0c
from68b8dbf1.493manifest-listed app/components/lib/prisma/dependency/config inputs
are compared:17trade/settings/schema differences, none in the exercised
acquisition/auth/capacity/receipt/storage workflow. The current source Prisma
folder is explicitly copied before migrate-deploy and client generation. The
actual input schema hash matches source; the regenerated81-model client includes
TradeDeckBundle and the actual migrated database has85tables. Generated schema
formatting has its own recorded hash; it is not claimed byte-identical to input.
This is no newly rebuilt complete application-image or new trade-workflow claim.
Current-head CI and
independent review are recorded on the PR before readiness. No app rebuild was
needed for test/report changes.

## Preserved earlier qualification

Head696998d4 on main3b06f208 passed four cases in52.3seconds, all84-table cleanup
pairs, all263 original/candidate checks, exact-head CI39997694530 and independent
review5632303284. It previewed the alternative destination only; it did not claim
the subsequent five-card addition/replay now exercised above. Its original
private evidence remains `.local-data/p7-capacity-handoff-20261023/`.
The new extension, current-schema/client binding, first/reassigned full ledgers,
originals and85-table cleanup records are in `.local-data/p7-reassignment-20261023/`.
No earlier pass or failure is relabeled as a current-head result.

## Preserved failures and limits

Automatic approval review rejected use of a retained review database without
current ownership verification. The test instead uses its own fresh installation;
retained review resources/data remain untouched. A private binding helper first
normalized line endings incorrectly; raw-byte comparison passes without changing
product source. Initial fixture attempts assumed an optional preview and copied
the wrong slot generation. The generation case reached its180-second timeout;
browser shutdown then prevented its original sequential cleanup from reaching
the database. Independent cleanup steps now all run and preserve all causes.
Exact recovery of that failed owner restored all84 table fingerprints. A later
test-only member relation query was corrected from `run` to `candidate.run`.
All failures/traces and the explicit recovery remain retained, not target passes.

Private evidence is `.local-data/p7-capacity-handoff-20261023/`: source binding,
four successful original/cleanup pairs, earlier failures/recovery and terminal
resource manifest. No scanner operation, other provider acceptance, natural
storage/process loss, authenticated manual-add interleaving, arbitrary writer
schedule, deployment or independent human acceptance is implied. Existing
#807/#881, #913/#914 and #922 owners remain separate. Merge still needs Brian's
individual approval and explicit request.
