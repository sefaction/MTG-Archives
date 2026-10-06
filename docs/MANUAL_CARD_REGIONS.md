# Manual card-region repair

Feature batch for #306 and recognition #463. The repair workflow is implemented
and undergoing browser/build/local Docker qualification. It is not yet delivered.
General multi-card detection, region-to-candidate expansion and duplex pairing
remain separate phase requirements. This batch makes no recognition-accuracy or
correction-library promotion claim.

An authorized reviewer can select four corners in the EXIF-normalized original,
apply that boundary and recheck the card, or explicitly restore automatic
geometry. Original bytes, source digest, physical candidate identity/count/order,
prior jobs and saved printing decisions remain intact. Inventory addition stays
an explicit preview/commit action.

## Integration

- The strict versioned quadrilateral must be finite, normalized, cyclic and
  convex, with at least32 pixels per edge and4096 square pixels in the original.
  Invalid selections fail without automatic detection or whole-photo fallback.
- The session-locked repair command binds owner authorization, source photo,
  digest, generation, request ID and resulting candidate revision. It atomically
  increments candidate and batch revision and saves before/after history separately from human
  review. Replayed acknowledgements apply once; changed bodies and stale edits
  are rejected. Retakes, purged/cancelled/committed cards retain their guards.
- OCR, visual retrieval, catalog reconciliation and printing carry the same
  instruction. Reviewed analysis is permitted only for an explicit current
  repair; later human review closes that permission. Admission, claim and
  publication preserve source, owner, generation, receipt and lease fences.
- Crop-specific visual/printing reuse excludes the request nonce, permitting
  identical selected geometry to reuse bounded evidence. Whole-photo or other
  region evidence cannot satisfy a selected-region request. Review projection
  filters by the active instruction so prior geometry cannot appear current.
- OCR uses the selected perspective derivative. Visual embeddings use that card,
  and geometric queries use masked original pixels. Printing queries retain
  original resolution and restore alignment coordinates into the original frame.
  Upsampled canonical images cannot satisfy printing's500-pixel source guard.
- Native descriptors include manual geometry/protocol source. Both native Docker
  images include the helper. The frozen encoder/reference index remains unchanged.
- Desktop/phone controls support pointer/touch and arrow-key adjustment, explicit
  apply/reset/cancel, retained failures, stale edits and exact-command retry after
  lost acknowledgement. An acknowledged repair advances only its own draft
  revision; a later server edit requires review. Printing drafts are preserved.
- Selected boundaries remain unverified. Manual analysis cannot automatically
  confirm a printing, including the supported printing-disabled legacy path.

## Qualification

- Synthetic geometry5PASS, including perspective/quarter-turn title/footer/border,
  convexity/size bounds, neighbouring-content masking and no source upsampling.
- Focused TypeScript protocol/reuse12PASS, including JSON field-order invariance,
  changed instruction rejection and exact crop/native evidence identity.
- Full native photo suite14PASS3.982seconds in an offline, read-only disposable
  container. Real entry points use synthetic pixels and model-free adapters:
  EXIF frame normalization, selected-region OCR/visual/geometric queries, invalid
  selection without fallback, unchanged byte digests and original printing
  resolution/coordinates. This is mechanics qualification, not model accuracy.
- Full disposable PostgreSQL and shared Inventory/import verification PASS,
 177.598seconds, source digest3f6ef09eff83dd3b076b3fc3b7e835246206094e232d108573c2faaeac2fd186.
  Evidence `.local-data/verification/acquisition-2026-10-06T16-13-25-017Z`.
  Tests exercise atomic history/rollback, owner/source/cancellation guards,
  competing edits/replay, reviewed four-stage repair/reset, late-crop rejection,
  exact crop reuse, evidence projection, later human-review fencing and existing
  acquisition/scanner/storage/dashboard/import/receipt workflows. Fixtures and
  owned PostgreSQL container/volume were removed.
- Complete core verification PASS:825 unit tests, Prisma/typecheck, production
  build and11 client manifests. Build caught a render-time retry-ref read; retry
  eligibility now uses React state while the request key remains event-only.
  Batch progress exposes candidate revision so another client's repair refreshes
  a reviewed card without changing its saved printing decision. The database
  gate covers exactly-once batch revision and full session rollback too.
- Earlier failures are retained: synthetic generation/read-direction omissions;
  real JSONB property ordering rejected unchanged source intent, corrected by
  schema-normalized comparison; an owned fixture remained visible to later
  dashboard text searches, corrected by retiring it after its own cancellation
  checks. No production guard or acceptance assertion was weakened.

Browser baseline on the existing cumulative app reproduced the missing control;
owned fixture cleanup, seven original row projections and13 service identities
were conserved. Corrected desktop1366/phone320 workflow and screenshots, actual native descriptors,
and cumulative Docker source/data conservation remain pending. The running app
still contains the previous four review batches; this feature has no PR yet.

Library privacy/storage and prospective sampling choices remain unanswered.
This feature does not create that library or select a retention policy. No fresh
physical feed or production operation has been performed.
