# Owner and Admin Mode review qualification (#308)

The original P6 tests explicitly include owner/admin and private-file access.
`tests/ui/acquisition-private-review.spec.ts` exercises that boundary through
actual authenticated browser sessions, API routes and the ordinary Enter/Exit
Admin Mode controls. It changes no product permission, schema or Inventory writer.
Related to #308; the separate acceptance map/presentation PR929 remains separate.

## Covered workflow

Each desktop1366x768/phone390/320 case starts with one actual authenticated
JPEG upload and a saved owner review. Native workers are absent; only the owned
unclaimed fixture job is settled. Separate owner, unrelated player and ADMIN-role
users have actual stored sessions/credential hashes; authentication is not mocked.

The owner sees the printing and receives the exact original bytes, with
`private, no-store` and `nosniff`. Anonymous requests, an unrelated player, a
forged non-admin mode cookie and ADMIN without Admin Mode cannot read that
original/review. Both foreign authenticated roles see the unavailable state,
receive403 for progress/review/original/preview and a review write, see no private
printing/destination text, and leave the full scoped source/review state intact.
There is no generated preview; its refusal tests authorization before availability.

The admin enters through the real server action, reloads the foreign batch,
receives identical private bytes and saves LP through the browser editor. The
candidate advances exactly one revision with the admin actor, one command and
one independent review event retain the original owner, and all older review
events remain unchanged. Original photo rows, actual file hash, session owner,
creator, location/section and target are conserved. Inventory, commits and stock
audit totals remain zero. Exit Admin Mode restores denial on fresh requests and
reload. The owner still sees the saved card and exact original. Previously viewed
pixels/browser memory are not claimed erased by exiting Admin Mode.

## Execution, binding and limits

All three final layout cases pass in49.9seconds, including explicit preservation
of the older review event and attribution of the new event to the admin actor.
The earlier three-case run passed in36.5seconds before those event assertions
were added. Current-head CI and independent review are recorded in the PR before
readiness. Screenshots and full before/after records are retained privately under
`.local-data/p6-private-review-20261023/`. Every executed fixture cleanup compares
every field/count in all80public tables against its original baseline.

The separately owned disposable app/PG/network uses640/384MiB limits, oneCPU
each, no extra swap and one browser worker after measured runtime admission.
493manifest-listed app/components/lib/schema/dependency inputs bind the reused
4b5ffcimage to this branch:17differences are trade/settings/schema inputs, none
affects the exercised review/auth/navigation/private-file workflow. The local
fixture has80tables; current-main CI has85. This fixture uses the app schema via
db-push, so it omits the three separate pricing tables (CardPriceSnapshot,
PriceImportJob, PriceWorkerHeartbeat), migration history and new TradeDeckBundle.
Those omissions do not affect the exercised review/auth/private-file inputs;
this case does not qualify pricing or the new trade schema. This is no entire
current-image, production, physical capture, accuracy or installation claim.

Preserved harness failures: initial fresh database bootstrap lacked pg_trgm and
stopped before any fixture rows; completing the interrupted indexes required
explicit empty-table verification. The first actual desktop case selected both
the application alert and Next route announcer; its cleanup conserved all80tables.
The locator now names the unavailable alert. Neither failure is a product defect
or a passing case; original logs/traces remain.

This bounded case satisfies the exercised role/session/private-original boundary,
not every possible session/device or correction-library history UI permutation.
Existing PostgreSQL history/rollback controls and the remaining P6 acceptance
map keep their own evidence. Keep #308 open for remaining applicable criteria and
individual PR approval/merge. Local success does not authorize a production action.
