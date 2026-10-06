# Manual card-region repair (in progress)

Feature batch for #306 / recognition #463, started October 6, 2026. This is
implementation work, not delivered local UI or a completed phase gate. The
existing cumulative Docker review and four pending PRs remain separate.

The manual repair workflow must let an authorized reviewer select a complete
card boundary in an existing EXIF-normalized original, run updated analysis, and
reset to automatic geometry. Original bytes, source digests, physical candidate
identity/count, prior jobs and saved human choices must survive. No Inventory
addition is implicit. General multi-card detection/region-to-candidate expansion
and duplex pairing are distinct remaining #306 requirements; a one-card repair
must not be reported as full phase acceptance.

## Implemented foundation

- Normalized versioned quadrilateral with cyclic convex boundary, finite bounded
  coordinates, source pixel/area limits and explicit failure for invalid input.
- Canonical perspective derivative preserving labelled title/footer/border
  pixels under all four quarter turns; a manual boundary remains unverified.
- Printing-query masking/cropping at original resolution, with original-frame
  offset. A canonical upsample must never satisfy the existing source-resolution
  stamp guards.
- Bounded framed input carries the selected region while retaining original
  bytes. Legacy raw PHOTO and declared CARD_SCAN inputs remain compatible.
  An old decoder rejects an unsupported manual region; no silent whole-photo
  fallback may replace a selected card region.

Initial geometry3, TypeScript protocol/schema3 and Python input5 checks passed
in isolated fixtures. A first expanded geometry run caught a refactor error in
the canonical evidence return (out-of-scope variable); the reference was
corrected and geometry4 passed in0.529seconds. The full existing native photo
input/text suite10 passed in0.301seconds and TypeScript typecheck completed exit0.
Final geometry5 passed in0.747seconds, including neighbouring-content masking
and no original-resolution upsampling. A side-by-side old/new native input
probe confirms the old decoder rejects this unsupported manual hint and the
new explicit decoder preserves its exact bytes/digest/region. All owned test
containers were removed. Synthetic results qualify mechanics, not
card accuracy. No native call site/UI/storage/admission integration is delivered.

## Remaining implementation and verification

1. Persist an explicit owner-authorized repair intent and append-only command
   at the session lock, increment candidate revision and preserve existing review.
   Lost acknowledgement retries must produce one repair intent/event. Retakes,
   foreign owners, purged/committed candidates and stale revisions remain guarded.
2. Bind the selected region to all OCR, visual, catalog and printing inputs,
   native descriptors and exact reuse identities. Scope any reviewed-candidate
   processing exception to the current explicit repair intent and source;
   preserve generation, receipt, lease, owner and publication fences. Human
   review changes retire old work. No general relaxation of reviewed admission.
3. Carry region geometry through native framing and printed alignment in the
   original coordinate frame. Keep printing queries at original resolution;
   suppress whole-photo fallback outside an explicitly selected region. Manual
   boundary selection is not automatic exact-printing authority.
4. Provide desktop/phone pointer and keyboard boundary selection, preview,
   explicit apply/reset/cancel, recoverable failures, stale-edit feedback and
   current processing status. Preserve unsaved printing correction drafts.
5. Real disposable PostgreSQL concurrency/replay/source/review/cache/fence checks;
   actual native requests against controlled pixels; browser workflow and visual
   review at1366/320; required build/core/import/acquisition checks. Inspect any
   failed baseline and retain its evidence rather than hiding it with timeouts.
6. Build/load cumulative local Docker with qualified native source generations,
   preserving index compatibility, all compose overlays and local quotas.
   Verify exact manifests and original source conservation. Open one coherent
   PR only after this complete repair workflow is reviewable. Individual merge
   approval is still required; keep #306/#463 open for their wider gates.

Library storage/privacy and prospective sampling choices are still unanswered.
This feature neither creates a correction library nor chooses its retention
policy. No production action or fresh physical scanner feed is authorized here.

## Integration direction

Keep the repair intent separate from the saved printing decision. Its trusted
server record must bind the photo ID, generation/digest, selected normalized
region (or explicit reset), request ID and resulting candidate revision. Append
the before/after repair command atomically at the session lock. Scope reviewed
processing to this explicit current intent; normal reviewed candidates remain
protected. Every stage's admission, claim, publication and reuse checks must
agree on source/region identity. Changing a printing decision or receipt must
fence earlier repair work. Historical saved jobs stay immutable.

Use the EXIF-normalized preview for pointer coordinates and the original's
EXIF-normalized dimensions for source limits. Do not derive source resolution
from a resized preview or canonical warp. A repair never certifies a physical
edge or recovers pixels already clipped from the original. Offer recapture
guidance for missing content. Do not silently discard an existing printing draft
when applying or cancelling a boundary edit.
