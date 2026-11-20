# Optional Unraid image and printing recognition

## Portal incident, November 19, 2026

Read-only inspection of two original scans and their saved review responses found
correctly read names but text-only printing suggestions: Boiling Seas was offered
as 9ED178 and Blaze as BBD167. Portal alternatives existed in the catalog. Both
responses had no visual/printing status and null image/printing evidence. The
running production Compose service list contained OCR and catalog workers, but
neither visual nor printing workers. The repository previously published only
web and OCR images; its hybrid overlays were local-only. This establishes a
missing image-comparison deployment path, not an optical model failure.

The inspected originals have readable names and copyright lines but no modern
printed set/collector footer. Text lookup therefore finds multiple printings
without evidence to distinguish them; the first text-only candidate is not a
confident printing identification. Hard-coding Portal from the batch contents
or treating a copyright year as exact identity would hide that uncertainty.

A private, offline replay used the unchanged original bytes, current native
source, the existing frozen DINOv2 index and all114,364 available reference faces
(904 unavailable). Neither expected labels nor batch names selected candidates.

| Original | Production first suggestion | Image retrieval first | SIFT first | Native time |
| --- | --- | --- | --- | --- |
| Boiling Seas | 9ED178 | POR119 | POR119,381 inliers | 20.054s |
| Blaze | BBD167 | POR118† | POR118†,257 inliers | 8.128s |

Both outputs explicitly retain `automaticAcceptance:false`. Blaze also offers
POR118 and PLST POR-118; this is not proof of general same-art/variant accuracy.
These two targeted development examples are not a held-out benchmark, batch
accuracy measurement, throughput guarantee or production rollout. Original
digests, full native results, descriptor, index/model identities, source hashes
and failed attempts remain in private `portal-recognition-20261119` evidence.
Related to #307; its broader accuracy acceptance remains open.

The canonical image also builds from committed source `b34ca835` as
`sha256:e4f9ea0add708057f3e31affba96506f083b6e7b01c09b44e9b0c07825543267`.
All 558 copied inputs match the Git export. Its bundled offline smoke and a
second full-index replay pass without source replacement mounts: the same
first identities and SIFT inliers, with times 18.030s/7.825s and automatic
acceptance still false. Later documentation edits do not change these inputs.
The six temporary containers and isolated builder are retired; the qualified
image and original evidence remain. Required exact-head CI is recorded on
[PR #1054](https://github.com/sefaction/MTG-Archives/pull/1054), separately from
this local build/replay evidence.

## Deployment package

The publisher now builds `ghcr.io/sefaction/mtg-archives-visual` from the existing
canonical `tools/acquisition-runtime/Dockerfile.visual`, subject to the same
verification and fresh-branch-head publication gates. An offline unprivileged
smoke check imports both native runtimes and verifies bundled symbol assets.
Weights, references and indexes are not included in the image.

`docker-compose.unraid.hybrid.yml` is an explicit optional overlay **after
`docker-compose.unraid.flat.yml`**. Do not paste it into the existing base file
or replace the private deployment environment with its example. Other overlay
chains require separate composition review. The ordinary production stack
remains OCR-only until this overlay is deliberately installed.

The overlay enables image and printing status on web, requires image work in
catalog reconciliation, and enables the review-only printing policy on the
catalog worker that actually owns automatic confirmation. The local printing
overlay now sets that last flag too. One visual worker is bounded to3GiB/one CPU;
one printing worker to1GiB/one CPU. Both retain restricted native children and
read-only original/public assets on the internal acquisition network. Missing
bind directories fail rather than creating empty host directories. No model,
ranking, threshold, schema, review-save or Inventory policy is changed.

## Before server activation

This package does not authorize deployment. Review the concrete installation
change with Brian only after these prerequisites are available:

1. Record the actual installed Compose chain, current service/image identities,
   resource owner and active work. Prepare and verify an exact configuration and
   database/originals recovery point. Preserve saved human reviews and Inventory.
2. Publish/build and verify the reviewed revision across web/OCR/visual images.
   Brian's November20 update policy requires installed normal-operation image
   references to follow `main`, so stop/pull/start advances without release-pin
   edits. Verify the resolved image revisions after pulling; record exact old
   image IDs/digests separately for rollback. Temporary rollback pins must return
   to the normal channel before handoff. Never substitute the OCR image for the
   visual/printing image. See [normal Unraid updates](UNRAID_UPDATES.md).
3. Provision a **complete, hash-validated, portable** index generation, matching
   encoder weights/source and public reference store on the server. Copy the
   immutable manifest and every referenced generation file, not only index.json.
   Confirm Portal coverage, unavailable references and catalog/model/transform
   digests. The local index is evidence, not an assertion that server assets exist.
   No GPU, new reference-maintenance service or public downloader is required for
   this frozen first rollout. Future refresh remains a separate operational step.
4. Add the four values in `docker-compose.unraid.hybrid.env.example` to the
   existing private environment. Preserve the existing DATABASE_URL and uploads
   path; do not expose credentials in logs or paste rendered configuration into
   a PR. Resolve the real flat+hybrid chain with `docker compose config --quiet`.
5. Check measured host memory/disk and current workers, allowing the additional
   4GiB of worker limits plus actual operating headroom. Serialize native checks.
   Using the verified pulled image, validate both `visual.py --describe` and
   `printing_worker.py --describe` with the exact read-only asset mounts, no
   application credentials, `--network none` and `--user 65534:65534`. Replay the
   private Portal originals offline against those assets before any live worker
   starts. Describe/import checks alone do not run the encoder or prove coverage.

Starting the durable workers can process the installation's eligible existing
backlog, not just these two cards. Obtain approval for that effect and the exact
service changes. No SQL repair, deleting old jobs, global retry, review reset or
Inventory operation is part of activation.

## Activation and rollback acceptance

After explicit installation approval, recreate only web/catalog/preparation
services whose flags change and start the two new workers through the reviewed
Compose chain. Keep unrelated services and the existing OCR replica count intact.
Observe real visual→catalog→printing job completion, bounded CPU/memory and
failure/retry behavior. Verify the original failing cards show Portal-first
suggestions and readable image status in desktop review. Capture before/after
saved-review and Inventory conservation. This is separate from source CI and
the two-photo offline result.

On failure, stop the two owned new workers, drain/verify their native children,
and restore/recreate the exact prior service configuration/image identities.
Retain durable observations, original photos and failure evidence; do not delete
jobs or restore an old database over newer user work. Old saved reviews remain
authoritative. A missing/unreadable reference, failed stage or similar artwork
requires review and must not be presented as printing certainty.

Current state: source package/local replay only. No production flags, services,
saved reviews, recognition jobs or Inventory were changed during this incident.
