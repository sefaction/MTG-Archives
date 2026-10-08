# Private correction review history

This batch advances issue463 and the correction inspection phase. Correction photos provides an optional View review history action for an existing example. It lazily reads up to twenty saved reviews per page and uses persisted review revisions, with stable event-ID ties, to page through the recorded sequence independently of clock order.

Each record distinguishes the suggestion used for that save, the previously saved decision, the new saved choice, human versus automatic origin, same-printing attribute edits and recorded evidence gaps. No recorded suggestion and no suggestion offered are separate states. Missing/unsupported fields stay explicitly unknown. Saved decisions remain unverified observations; reading the history never reinstates a withdrawn label. Library withdrawal is separate from a scan-review save.

The new private no-store history endpoint reuses the current owner/Admin Mode authorization. Successful cross-owner Admin Mode reads are audited; an inactive account, forced password change, wrong owner/example or mismatched cursor is denied. The owner lock coordinates metadata reads with removal. Removed examples cannot be read. Records survive the original acquisition lifecycle through the existing independent library.

The browser receives an allowlisted projection, not raw evidence bundles, actor/source identities, signatures, worker outputs or filesystem context. Historical evidence is not backfilled, verification permissions and cohort rotation are not guessed, and recognition/Inventory/capture/removal policy is unchanged.

Qualification in progress: four focused projection/privacy tests passed and the full core pipeline passed845 unit tests, typecheck, production build and thirteen client manifests. The new real PostgreSQL authorization/paging/removal verifier is registered in the existing acquisition integrity pipeline. Desktop/phone real API browser tests are written but have not run against a loaded implementation yet. Final fixture typecheck, disposable PostgreSQL, cumulative Docker/native source parity and browser/data-conservation gates are still required before PR delivery.
