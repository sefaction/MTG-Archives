# Imports workspace

Issue #267 extends the approved UI consolidation patterns to inventory capture and review. The existing `/imports` route and batch URLs remain supported.

## Task homes

| Task | Home and preserved behavior |
| --- | --- |
| Upload CSV | `/imports` or `?view=csv`: owner scope, duplicate policy, sample download, background resolution and recent batches |
| Manual add | `?view=add`: exact printing search, attributes, storage/section preview and explicit add; existing `singleCardAdded=1` return link remains valid |
| Export | `?view=export`: whole collection or normal-location CSV, including exact-printing Moxfield output; `exportTools=1`, owner and location deep links remain valid |
| Review | `?batchId=…`: owner/status, row and physical-copy totals, resolution controls, filters, row actions, one destination/commit form |
| Resolve a row | `resolveItemId`, `resolverQ`, `status` and `q`: native dialog, keyboard dismissal, attribute edits, match selection and attempt history |
| History | `?view=history`: latest 25 batches and per-batch actions, followed by owner-scoped cleanup or admin maintenance |
| Admin batch maintenance | Review disclosure: tracked undo preview/confirmation and history-only deletion |

The compact sticky review summary links to the commit form after the row table. The full destination picker is not sticky, so phone screens retain room for the working content. Commit confirmation identifies ready rows and physical copies; row-specific locations/sections retain precedence over the fallback destination. Duplicate policy is shown at review and commit. Existing ownership and mutation services are unchanged.

Uploaded batches and saved row edits are persisted. Leaving a task does not commit inventory or delete its batch. Unsaved manual-add, row-edit and destination inputs are discarded on navigation. Resolution jobs retain their existing resume/cancel controls. Inventory import remains separate from pasted decklists in the deck builder.

## Validation boundary

The fixture lifecycle covers a real two-row CSV, local-printing resolution, cancelled/confirmed commit, copy conservation, row-specific versus fallback sections, private-batch access and a 120-row saved review. Layout checks cover desktop, 390/320px phones and enlarged text. Exact outcomes, image/commit and any failures are recorded in WORK_CHECKPOINT.md and the PR.

The table retains all filtered rows and history remains limited to the latest 25 batches. This is not database pagination, a production-scale import benchmark, or a replacement importer. Existing intermittent navigation/occupancy issues #220/#260 and remote-image deck-test issue #280 remain separate.
