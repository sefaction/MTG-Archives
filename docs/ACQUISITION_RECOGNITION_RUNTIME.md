# Local photo recognition worker

The scan page now displays **possible printings** for each prepared photo.
This batch connects the measured PaddleOCR CPU pipeline to durable application
jobs and the existing local Card catalog. Suggestions are never accepted
automatically. Condition/finish remain explicit batch defaults with per-card
overrides in the upcoming review flow. Inventory commit is not enabled here.

## Runtime boundaries

- The ordinary acquisition worker prepares private previews. A separate worker
  discovers completed, current photo jobs and durably queues recognition.
  Duplicate discovery is protected by the existing job uniqueness constraint;
  retakes get a new artifact and cannot publish old results over the new revision.
- One bounded native process keeps the CPU models warm. It receives a length
  header and at most 10 MB of image bytes, returns at most 64 KiB of JSON, and
  is killed on abort, malformed output or exceeded bounds. No child receives
  database credentials through its input or environment, or performs Inventory
  operations. The Linux native process runs as UID/GID 65534, separate from the
  database-owning parent worker.
- The worker reads originals and cached models through read-only mounts. Its
  Docker network is internal, connected only to the local database network;
  no inference port is exposed. Model bootstrap is a separate preparation step
  performed without private photo mounts.
- A single database statement reads the recognition catalog projection. Its
  exact ordered contents are hashed and kept in memory for this worker's life.
  Restart the worker after catalog maintenance to load another snapshot. Old
  queued versions are not silently executed against different data.
- Each result retains input digest, actual catalog/index digest, model and
  runtime descriptor, code/geometry hashes, raw text/polygon evidence, proposal
  reasons and timing. A complete source import does not establish universal
  language coverage. Name/fuzzy matches and conflicts always require review.
- Geometry is a single-card crop proposal, not a physical-count classifier.
  Unsupported geometry produces no title/footer guess; the saved photo remains
  available for retake/manual review. Raw bytes remain private and unchanged.
- The web endpoint rechecks photo ownership/Admin Mode and exposes a compact
  proposal DTO, not native logs. It is no-store. Only the visible photo tiles
  poll; completed responses stop polling, and a retake starts a new tile.

## Local preparation

Build the existing evaluator images as described in
[`tools/acquisition-eval/README.md`](../tools/acquisition-eval/README.md), and
prepare their pinned offline model cache without mounting private images.
Then build from the selected review worktree:

```powershell
docker build -t mtg-acquisition-recognition:local -f tools/acquisition-runtime/Dockerfile .
docker build -t mtg-archives-web:local -f Dockerfile .
```

From the primary local runtime checkout, supply the absolute prepared cache
path in `MTG_ACQUISITION_MODELS_PATH` for the command and add
`docker-compose.recognition.local.yml` to the existing Compose overlays,
including `docker-compose.acquisition.local.yml`. Use the review worktree's
absolute overlay paths. Reload the normal local services, canonical worker and
`acquisition-recognition-worker` with `--no-build --pull never`.

The recognition overlay gives the local database an additional internal
network; its first use recreates the local database container while preserving
its existing named volume. It is not a production Compose change. The worker
is bounded to one CPU and 2 GiB; no GPU or cloud inference is used.

## Evidence and limits

Native protocol tests exercise JSON bounds, process termination, model-process
reuse and clean restart after abort. Real PostgreSQL fixtures exercise
concurrent handoff/replay, retake admission and stale-result rejection.
The offline Linux run with a real Android photo passed with networking disabled.
Repeating that same photo in one warm process measured 6.928 s initially and
2.610 s on the second attempt during local build activity; this is a timing
sample, not two physical-card detections or a general latency guarantee.

Run the local browser fixture with `MTG_LOCAL_PILOT_TEST=1`,
`MTG_ACQUISITION_CORPUS_PATH` pointing to the private ten-photo directory, and
`MTG_ACQUISITION_RECOGNITION_TEST=1` to require real background recognition and
the expected printing among each photo's twelve suggestions. Without the last
flag the fixture proves intake/preparation only. Real-device Android HTTPS,
explicit per-card review, commit and seven-day post-commit deletion remain
subsequent integration gates. These ten photos are development samples, not a
held-out recognition accuracy claim or a four-user throughput certification.

The opted-in end-to-end browser run passed with all ten original photos and
their exact printing among 12 suggestions, plus recovery/retake/capacity and
anonymous endpoint denial. It took 1.3 minutes including capture fixtures during
a concurrent build. The screenshot was inspected at the phone width. The
worker's post-run memory was 940.1 MiB within its 2 GiB limit; this is not a peak
memory claim. Native child UID 65534 and absence of database credentials were
verified in the live Linux container. Runtime model cards in the private cache
identify both mobile models as Apache-2.0; no weights or photos are in Git.

