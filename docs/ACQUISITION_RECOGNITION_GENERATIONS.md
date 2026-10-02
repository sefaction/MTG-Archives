# Recognition generation queue recovery

Issue #566; related production report #565 remains under investigation.

The local queue contained 1,174 pending recognition attempts for unavailable model
fingerprints, including 1,164 with newer current-model replacements for the same
immutable photo and physical-candidate revision. The handler rejected unavailable
models before native inference, but generic retries repeatedly spent queue claims.
This observation does not establish the production report's exact cause.

Before each recognition claim, the worker now retires a different-version attempt
only if a strictly later-created replacement exists for the same stage, run,
artifact, candidate, candidate revision, photo ID and byte digest. Pending work and
expired leases qualify; live leases and completed/failed observations retain their
authority. Replacements must be pending, running, complete or failed; an already
superseded replacement cannot retire another attempt. Attempt timestamps establish
ordering, not a semantic ordering of model fingerprints. No model-selection,
owner/run scheduling, publication, image reading, review or Inventory rule changes.

## Bounded local measurements

The queue continued running during investigation: immediately before worker
replacement, 1,001 remaining pending attempts met the guard. After startup, all
1,001 were SUPERSEDED with GENERATION_REPLACED and zero qualifying pending attempts
remained. These are avoided claims/retries; unavailable attempts already failed
before inference, so this is not a native-inference or throughput measurement.

Before/after aggregates retained 907 photo records, 81 saved-review records, 10,280
Inventory rows and 12,482 physical copies. The disposable database regression also
compares candidate/artifact rows exactly and verifies Inventory conservation.
Existing failed observations remain visible rather than silently retried.

## Validation and review build

- Real PostgreSQL 100-card fixture: 93 proven replacement cases retire; seven
  deliberate live/completed/missing/order/digest/revision/superseded exceptions
  remain. Repeated recovery retires zero; reverse-version invocation cannot retire
  later-created attempts. The normal claim demonstrates the obsolete baseline.
- Complete owned acquisition and shared-import integrity passes, including queue
  fairness, concurrent claims, expiry/retry, review fencing and explicit commits.
  Runner evidence: acquisition-2026-10-01T23-56-33-255Z; owned database/container removed.
- 760 unit tests and TypeScript pass. Production Docker build validates the retained
  scanner installer. Full verification passed (28 browser checks; 81 explicit
  opt-in skips). Three successive real native batches passed through refresh and
  preserved original hashes, with zero Inventory: 23.5s, 34.6s and 12.6s to native
  completion for controlled blank inputs. These times are not card accuracy or
  production throughput measurements. Correction drafts, two scan-retention
  layouts and 12-image upload interruption/reload also passed. The library test
  needed its stale exact-visible-row assertion corrected for automatic paging;
  its final recheck is recorded in the PR.
- Local application source proof: 507 inputs, digest
  d06acacfbd0edb6669a22ba19897b3cab68c5eb7bd8beca4481facf87448df1e;
  web image sha256:9724638a6dc6e91a10747b3e46030f285568478dac399e2a5cab76f7a3d31a1e.
  Local queue-worker overlay changes only acquisition-recognition-worker.ts on the
  existing qualified scanner-framing image. The loaded native model fingerprint
  remains 7284e774f0c60a590b5e01ec77005fff755e0f17335cbd3f3c2ead80693f64cd.
  Python/model files and visual/printing images are retained; #552/#560 still track
  native source portability. CI builds the ordinary committed native image.

No physical scanner or production operation was performed. #565 needs production
queue/runtime evidence or operator acceptance after the normal approved update;
it must not be closed solely from this local queue regression.