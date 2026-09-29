# Recognition accuracy goal

User-authorized active work, September 28, tracked in #463. This goal continues
across batches; reference downloads, benchmarks or one green PR do not complete it.

## Requested end state and required evidence

| Requirement | Evidence required before completion |
| --- | --- |
| Combine image and readable text against the full supported catalog | Actual image retrieval and OCR union in the local application's background workflow, complete reference coverage accounting, all faces/printings represented, real-photo full-catalog comparison and regressions |
| Verify exact printing, including Planeswalker stamp and other distinguishing details | Observed present/absent/unreadable evidence; original/List and same-art printing pairs; contradictions and unreadable checks do not become absence; name/artwork similarity alone cannot confirm an exact printing |
| Reconcile printings absent from the local catalog | Real Scryfall metadata fallback through the existing cache/normalizer, then recognition without restart; isolated catalog-omission tests and live read-only API verification; clear missing-catalog versus unreadable-photo versus unavailable-provider states |
| Automatic catalog refresh | Bounded/resumable/versioned maintenance, image/index updates and running worker refresh; crash/retry and stale-version checks; no broken existing Card/Inventory references |
| Reasonable confidence for large scanner batches | Independently labelled additional/unseen material, correct first choice and candidate recall, wrong automatic decisions reported separately, conservative handling of unresolved printings, and measured resource/batch/restart behavior |
| Preserve reviewed user decisions and data | Ownership, revision, capacity, duplicate-safe explicit Inventory commit and original-photo retention tests; old decisions are not silently changed by a model/catalog update |
| Disposable images and local testing | Models/references/indexes/config outside Docker images, CPU functionality verified, local Docker review; production unchanged |
| Delivery | Coherent PR batches with individual user merge approval; linked issue closure only when the full relevant scope is verified |

The first reference dataset is the previously verified default_cards snapshot:
all non-digital records and available image faces, with explicit missing and
placeholder entries. This is not all-language coverage. New/non-English printings
need the metadata fallback and language/printing checks rather than silently
assuming English. Default bulk metadata remains an index/cache input; the
application's existing Card table remains the authority for card identity.

## Current measured starting point

- Runtime: PaddleOCR title/footer, both portrait reading directions; no deployed
  image matcher, stamp detector, set-symbol detector or acquisition external fallback.
- Photo development set: 23 labelled Android originals, 15 exact-first / 21 in12 /
  8 correct strong, with two Winter photographs still failing localization.
- Scanner comparison: 17 SmartOffice PS286 Pro images, 15 exact-first / 17 in12 /
  11 correct strong after pending PR #470; two original/List ambiguities remain.
- Previous visual diagnostic: 3,635 references selected using corpus names. VGG16
  is promising but those results do not establish full-catalog or unseen accuracy.
- An additional 28 phone images remain to label independently before scoring.
  Image derivatives and pictures of the same physical card are not independent
  held-out examples. Finish and condition retain user defaults/overrides.

## Implementation sequence

1. Prepare all supported reference faces with durable resumable state and honest
   coverage. Compare full-catalog image methods, OCR union and geometric reranking.
2. Integrate useful candidate retrieval in the app and expose its actual evidence.
   Establish exact-print checks and stamp present/absent/unreadable behavior.
3. Integrate metadata fallback and catalog/index refresh. Work on independent
   parts while larger indexing/evaluation jobs run; do not wait idly on assets.
4. Validate the combined pipeline on additional/unseen examples and larger batches;
   fix measured gaps and publish explicit accuracy/resource limits. Keep the goal
   active while any requirement above lacks authoritative evidence.

No threshold may be loosened merely to produce more automatic confirmations.
Nearest-neighbor distance is not calibrated probability. Zero observed errors
in a small development set does not guarantee a whole future batch is correct.
