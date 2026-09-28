# Local photo recognition worker

The scan page displays possible printings and automatically confirms strong exact
printing matches using saved batch finish/condition defaults. Every confirmed
card remains correctable before the explicit Inventory action. Name-only,
ambiguous, conflicting or unsupported-attribute results remain pending.
See [automatic confirmation](ACQUISITION_AUTO_CONFIRM.md) for the evidence rule,
worker safeguards and limits. The native OCR process itself has no confirmation
or Inventory authority.

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

Build directly from the selected review worktree; evaluator images are not required:

```powershell
docker build -t mtg-acquisition-recognition:local -f tools/acquisition-runtime/Dockerfile .
docker build -t mtg-archives-web:local -f Dockerfile .
```

From the primary local runtime checkout, add both acquisition overlays using
the review worktree's absolute paths. The recognition overlay initializes its
persistent `./.local-data/acquisition-models` directory automatically. Override
`MTG_ACQUISITION_MODELS_PATH` only to choose a different persistent directory.
Reload normal services and both workers with `--no-build --pull never`.
The database's additional internal network can recreate its container while
preserving its existing named volume. Recognition is bounded to one CPU and
2 GiB; no GPU or cloud inference is used.

## Flat Unraid deployment and persistent data

The earlier flat Compose omitted both acquisition workers. That explains a
queue staying at Preparing photo when deployed from that file: the web service
accepts uploads but does not process them itself. Issue #459 tracks this gap.

The corrected flat file starts `acquisition-worker` for preview preparation and
seven-day committed-photo cleanup, `acquisition-model-init` for model setup, and
`acquisition-recognition-worker` for identification. Both workers wait for web
health/migrations; recognition also waits for successful model setup.

Persistent files belong under MTG Archives appdata:

| Data                                     | Host storage                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Originals and prepared previews          | Existing `UPLOADS_DATA_PATH`, shared with web                                         |
| Recognition models and verified manifest | `ACQUISITION_MODELS_PATH`, default `/mnt/user/appdata/mtg-archive/acquisition-models` |
| Sessions, jobs, review and Inventory     | Existing PostgreSQL data mount                                                        |
| Operator configuration                   | Existing Compose Manager `compose.yaml` and private `.env`                            |

Images contain application code, dependencies and a public model-download
manifest, with no model weights, uploaded photos, database files or private
configuration. Setup refuses to write without a `/models` mount. It downloads
only public model files pinned by revision, byte size and SHA-256, writes them
atomically into a manifest-versioned directory, and verifies existing files on
repeat runs. Model changes create another version; old versions are retained.

The setup container has no private-photo mount or database environment. Once
setup exits successfully, recognition mounts models and uploads read-only and
runs on an internal network. Temporary library scratch files under `/tmp` are
disposable. Recreating containers preserves the appdata files; an unchanged
setup can complete offline using those files. Initial setup or missing/damaged
files need access to the pinned public Hugging Face downloads.

### Operator deployment steps

After this PR is approved/merged and **both** image publications succeed:

1. Replace the production project's `compose.yaml` with the updated
   `docker-compose.unraid.flat.yml`. Preserve the production `.env` and existing
   paths/passwords; merge the new `ACQUISITION_MODELS_PATH` setting from the
   credential-free flat environment example. Local overlays use laptop paths
   and must not replace the Unraid file.
2. In that project's directory, run `docker compose config --quiet`,
   `docker compose pull`, then `docker compose up -d`. Use Compose Manager's
   equivalent controls if preferred. Pulling only the web image does not add
   the missing services. `IMAGE_TAG` selects both published image versions;
   an optional `ACQUISITION_RECOGNITION_IMAGE` overrides recognition explicitly.
3. Inspect `docker compose ps -a` and the three acquisition services' logs.
   Model setup exiting with code 0 is expected. Workers should remain running;
   recognition logs readiness after its catalog snapshot loads. Eligible queued
   jobs resume automatically; exhausted or failed captures may need Retry.

No production deployment or data changes were performed for this fix. Pricing
archive maintenance and raw retention remain disabled by default. Recognition
uses the deployment's existing Card catalog; printings absent there cannot be
proposed. The laptop's full catalog import was local-only, so its coverage does
not establish production catalog coverage.

### Deployment verification

`scripts/verify-acquisition-flat-compose.ts` renders the credential-free flat
configuration and checks worker presence, shared paths, read-only inference
mounts, setup ordering and internal network isolation. The image publisher
initializes a disposable mounted model volume, verifies it offline, then loads
and runs the models offline as UID 65534 before publishing the recognition image.

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
flag the fixture proves intake/preparation only. Review, explicit commit and seven-day post-commit retention have separate
local acceptance evidence. Real-device Android HTTPS/camera acceptance remains
open. These ten photos are development samples, not a
held-out recognition accuracy claim or a four-user throughput certification.

The opted-in end-to-end browser run passed with all ten original photos and
their exact printing among 12 suggestions, plus recovery/retake/capacity and
anonymous endpoint denial. It took 1.3 minutes including capture fixtures during
a concurrent build. The screenshot was inspected at the phone width. The
worker's post-run memory was 940.1 MiB within its 2 GiB limit; this is not a peak
memory claim. Native child UID 65534 and absence of database credentials were
verified in the live Linux container. Runtime model cards in the private cache
identify both mobile models as Apache-2.0; no weights or photos are in Git.

Deployment repair validation (2026-09-27): clean deployment-recipe image builds,
initial persistent download, offline repeat, read-only hash verification and
non-root offline inference passed. A disposable damaged-file fixture was
rejected, repaired from the pinned source, and verified offline. Setup without
a mount refused to write, and a fresh image contained no `/models` data.
The flat configuration and Pricing default-off guards passed, as did all 648
unit tests. Production was not changed.
The replacement runtime also passed the ten-photo browser workflow in 1.7 minutes:
all ten expected printings appeared among proposals, four strong matches were
correct, and correction/explicit commit/retry remained functional. The sample
prepared all ten photos in 8.7 seconds; this is local development evidence.
