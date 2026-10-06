# Manual card-region repair

Feature batch for #306 and recognition #463. The repair workflow is implemented
and qualified in cumulative local Docker for individual pull-request review.
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
- GitHub's first Core run exposed a transitive Torch import in the model-free
  visual test adapter. Reproduced with14 tests/one error in an offline Torch-free
  image, then corrected by replacing the already-mocked matching adapter and
  explicitly blocking Torch imports. All14 tests pass there in0.479seconds with
  the same pixel/geometry assertions. Production code and runtime descriptors
  are unchanged; actual model inference remains separately qualified above.
- The next CI run exposed the existing descriptor fixture's Docker-only /eval
  assumption. It now hashes actual checkout files and verifies input decoder,
  manual geometry and baseline geometry hash changes alongside all previous
  dependencies. A clean Python3.12 image with only CI's NumPy/OpenCV/Pillow,
  no Torch and no /eval passed all93 native CI tests across seven groups. No
  production path, descriptor input or prior assertion was removed.
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

The old-app browser baseline reproduced the missing control. The corrected
desktop1366/phone320 case passes, including pointer/keyboard/real touch controls,
44-pixel handles, no horizontal overflow, invalid selection, failed save, an
applied command with a lost acknowledgement, exact replay, printing drafts
through reload, stale corner retention, explicit automatic reset, another
client's repair refreshing a saved review, and exactly one explicit Inventory
copy/receipt. Post-commit repair is rejected. Screenshots were inspected; private
evidence stays in ignored `test-results` and `.local-data/verification`.

Initial browser expectations incorrectly looked for a condition field after
Cancel had closed the form, then used the wrong case for its summary caption.
Those failed traces are retained. The corrected assertions reopen the form and
check the saved original/NM choice; no saved-review assertion was removed.

The cumulative source includes PR655, PR656, PR658 and PR659. Its complete
No section desktop/phone scanner cases also passed again in this loaded build
(2/2,42.1seconds), including explicit Inventory confirmation and reservation
conservation. No hardware was exercised.

Its complete
disposable PostgreSQL/shared-receipt gate passed in160.873seconds at local
commit7fb6fb2853cdbbaefb735199abcae044cc560f19, source
79cd5c3e88e97dd907014d7581b56cbae95fa55aaa32ac1470d7f5182ec6efde.
All825 cumulative unit tests pass. Installer-required web and both native image
recipes built. Actual offline native descriptors and synthetic inference pass
OCR/visual/printing through the production privilege-separated child wrapper.
The printing smoke's initial driver omitted its outer stream frame; the native
parser rejected it, and the properly framed rerun passed. This remains mechanics
qualification, not held-out printing accuracy.

Loaded web image:
`sha256:e023185fc704f06cc217e1bed640821d5b17c9571a5912008ec61ce97336d906`.
The exact563 runtime inputs match digest
`1d3f501bfcaa8198a595ae88ad38485807f9f8a958bb7b15a1c28d3a26687895`.
Native OCR image:
`sha256:7edbd4f0c6895f4215f9605700fbe25564a30e65ffe7108ab2cc2dfcd0ab6e7a`.
Visual/printing image:
`sha256:45d79920bd2b6e4c4bafc7c5dbfeeabc858d3abb65424889447a2208708d2783`.
Their actual descriptors are590b8003/c7ca99b3/6e85d3c1 respectively; the
captured immutable index contains112,667 public reference faces. Encoder,
automatic geometry, loader and printing-policy source match the earlier
runtime. Existing weights/index mounts are reused read-only; no index rebuild
or model download was initiated.

The nullable migration and six-service reload preserved all seven complete
original row projections (candidate JSON excludes only the new nullable column).
Source Inventory remains10,292 rows; candidates1,091, photos1,093, artifacts1,092,
receipts2/members18 and scanner runs31. All1,092 ready retained originals passed
their stored SHA-256 checks, totaling2,832,075,218 bytes. Owned browser users are
zero after cleanup. All13 services retain mounts/resource limits, and the seven
other services retain exact images/start times/restart counts. Docker's mount
array order is normalized for comparison; values remain fully checked. Existing
Compose overlays and64/4 photo quotas are preserved.

Library privacy/storage and prospective sampling choices remain unanswered.
This feature does not create that library or select a retention policy. No fresh
physical feed or production operation has been performed.
