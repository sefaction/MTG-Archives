# Vault / inventory pilot

## Review scope

- New and existing locations typed `Vault` expose `Sect 0` through `Sect 5`, including empty sections. Type matching is case-insensitive. Defaults are derived from the type, not synthetic inventory rows; no migration or reassignment is performed.
- Each default section has advisory capacity 85. Locations, inventory moves, manual additions, and import review show current occupancy. Custom labels remain available and have no inferred capacity. Unsectioned cards remain unsectioned.
- Select one or multiple exact-printing rows, search destination paths, click a section, and choose all copies, 85 copies, or remaining space. An explicit maximum splits the last stack when necessary. Processing order is oldest stack first, not the visual table sort.
- Whole stacks retain their IDs and provenance. Partial moves create a new row carrying physical attributes and provenance, keep reserved trade copies on the original row, and link both sides in the audit. Same-section selections do not add occupancy.
- Inventory bulk moves, per-stack move actions, and whole-location moves use the same serializable storage transaction. Stale submitted stack quantities/placements are rejected; conflicts roll back with a refresh/retry message.
- Destination and copy-limit choices remain after a successful batch. Selection clears and server counts refresh; filters and scroll context are preserved.
- Non-admin destination metadata ignores an untrusted owner filter. Public/read-only inventory does not receive private storage summaries.

## Local validation commands

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build --pull never
curl.exe -s -o NUL -w '%{http_code}' http://127.0.0.1:13001/login
$env:MTG_LOCAL_PILOT_TEST = '1'
npm.cmd run verify
docker exec -e MTG_LOCAL_PILOT_TEST=1 mtg-archives-web-1 npx tsx scripts/verify-vault-pilot.ts
```

Wait for Compose to finish and the host URL to return 200 before browser tests. Container health alone is not sufficient to establish Windows host access. A web-only restart recovered the initial host empty-response incident without touching database contents; its underlying cause was not proven.

Browser tests use one worker because this local suite shares an account and snapshot. The pilot's opt-in browser test checks the exact loopback URL, creates uniquely named fixtures, exercises actual moves and owner isolation, takes desktop/phone screenshots, and removes only those fixtures. The database script requires the explicit local-test flag and removes its own unique test owner, inventory, locations, trade and audit records.

Screenshots: `test-results/vault-desktop.png`, `test-results/vault-phone.png`, `test-results/vault-occupancy-phone.png`. These are local ignored artifacts, not production collection exports.

## Coverage and limits

- Database coverage includes partial fills, conservation, same-section no-op, advisory overflow, provenance and trade links, reserved partial copies, stale selections, unauthorized/inactive/system-managed destinations, concurrent requests, and grouped occupancy for 150,000 physical copies over 3,000 rows and 1,200 locations.
- This scale test measures the storage summary, not end-to-end page rendering or 150,000 unique printings. The existing Locations management UI creates many per-location controls and still needs a dedicated large-tree rendering audit.
- Capacity is a preview, not a reservation of space. Another user can change occupancy before submission. Explicit copy limits stay fixed and capacity remains advisory; “Fill remaining space” is not a hard fit guarantee.
- Import preview assumes ready copies use the selected destination; row-level placement overrides take precedence. Scanner ingestion itself is unchanged.
- Existing arbitrary names such as `Section 0` are not silently merged with `Sect 0`. Only the six standard labels receive automatic vault capacities. Renaming the location type away from Vault changes default presentation, never inventory placements.
- General edit/split, trade, deck commitment, import concurrency, and destructive recovery paths are not certified by the new move transaction tests. A green suite does not establish full application feature parity or absence of all bugs.
- Scheduling remains unconfigured. This is a user-started pilot, not an unattended recurring run.

## Tracking

- #211: vault/storage requirements
- #212: deterministic browser baseline and current UI expectations
- #213: storage move provenance and trade-reference preservation
- #214: owner-scoped destination metadata
- #216: all-matching copy counts and multi-location selection
- #215: follow-up large-tree/editor rendering audit (not part of this delivery)

## Feature coverage checkpoint

| Surface | Pilot coverage | Remaining audit |
| --- | --- | --- |
| Vaults / inventory | Creation, counts, selected copy limits, overflow, mobile, stale/concurrent moves, owner isolation | Large-tree rendering and mixed-owner usability |
| Imports / manual add | Shared occupancy picker; existing import/export browser checks | Scanner round trip, placement overrides and import concurrency |
| Decks / public views | Existing browser and unit regressions | Full role/visibility and League parity matrix |
| Trades | Reserved copies and reference preservation in storage transactions; existing browser regressions | Complete multi-user exchange and general edit/split reservation audit |
| Settings / notifications / admin | Existing browser smoke tests with corrected current UI selectors | Live delivery and failure/retry scenarios |
| Backups / recovery | Backup UI smoke only | Disposable restore drill; no production recovery exercised |

This is a bounded coverage checkpoint, not a feature-completeness certification.

One review batch; no merge without explicit approval. The branch includes the earlier setup commit from PR #210. Review dependency and exact local image/commit evidence are recorded in the pilot PR.
