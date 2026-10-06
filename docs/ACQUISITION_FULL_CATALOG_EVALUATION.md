# Full-catalog recognition evaluation

The separate [October 5 model/source audit](RECOGNITION_MODEL_SOURCES_20261005.md)
records installed public model identities, declarations and active local index
encoder bindings. It does not expand this evaluation's historical coverage.

This is preparation and offline evaluation for #463, not a deployed image matcher
or an exact-printing confidence claim. The existing app still uses OCR. The full
requested outcome is in [the recognition goal](ACQUISITION_RECOGNITION_GOAL.md).

## Data and coverage

`catalog_references.py` consumes a verified, frozen Scryfall `default_cards` gzip
JSONL snapshot. It includes every non-digital printing, all image-bearing faces
and explicit missing/placeholder entries. It never restricts the reference pool
using the test photographs' names or expected identities. A top-level image is
kept as the composite reference when that is how Scryfall represents the card.

The September 27 snapshot contains 118,404 records, 109,269 non-digital cards,
112,472 downloadable reference images and 899 unavailable face entries. This is
default-card coverage, **not all languages or printings created after the snapshot**.
Metadata fallback and refresh are separate required runtime work.

Only public image requests go to `cards.scryfall.io`. Original user photographs
are never uploaded. Download starts are paced, concurrency is bounded, connections
are reused, and 403/429 responses stop the invocation. Inspect the persisted error
before explicitly retrying. Scryfall distinguishes its API request limit from
static file hosts; use bulk metadata for this preparation. [Scryfall access FAQ](https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17)

Images, model weights, progress databases and indexes belong in persistent local
data/appdata. They are excluded from Git and Docker images. Offline evaluation
containers have no network access; reference/model/photo mounts are read-only.
Use a separate writable mount containing only evaluation output.

## Resumption and integrity

The downloader commits each validated JPEG and its digest to SQLite. An OS lock
prevents concurrent writers and releases on process termination. A changed bulk
snapshot requires a new directory. Missing and placeholder images remain explicit;
they never become successful downloads.

Run `catalog_snapshot.py` on the downloader's host. Its read transaction exports
a consistent view while the downloader continues. Docker indexes that JSON, not
the live Windows SQLite WAL. Re-export the snapshot after more downloads complete
and rerun the indexer to add new references.

The indexer binds its cache to the catalog, encoder source, model weights,
preprocessing and library versions. It validates original image digests on resume,
checks cached vectors, and commits feature batches transactionally. A final
matrix/reference generation is written before the manifest switches atomically.
Readers verify both files' hashes. Interrupted or corrupt output is never silently
accepted. Older/unreferenced generation directories may remain as evaluation
artifacts; no automatic production cleanup is installed by these tools.

`downloadComplete` means every downloadable face in this snapshot is prepared.
`allReferencesAvailable` is stricter and is false when the provider lacks images.
An index built while downloads run remains explicitly partial. `catalog_compare.py`
requires complete downloading unless `--allow-partial` is explicitly supplied for
a smoke check; those reports retain coverage and missing-expected-card fields.

## Encoders and scoring

- **VGG16:** existing diagnostic method, convolution features plus global average
  pooling, 512-dimensional normalized vectors. Weights SHA-256
  `397923af8e79cdbb6a7127f12361acd7a2f83e06b05044ddf496e83de57a5bf0`.
- **DINOv2 ViT-S/14:** comparison candidate, 384-dimensional normalized features.
  Official source commit `7764ea0f912e53c92e82eb78a2a1631e92725fc8`; local source
  digest is recorded. Weights SHA-256
  `b938bf1bc15cd2ec0feacfe3a1bb553fe8ea9ca46a7e1d8d00217f29aef60cd9`.
  [Official source](https://github.com/facebookresearch/dinov2/tree/7764ea0f912e53c92e82eb78a2a1631e92725fc8),
  [official weights](https://dl.fbaipublicfiles.com/dinov2/dinov2_vits14/dinov2_vits14_pretrain.pth).

Both resize the whole RGB card to 224×224, use ImageNet normalization and float32
L2-normalized features. Neither center-crops away the footer. These are generic
features, not card-specific training or calibrated probabilities. DINOv2 is not
assumed superior; actual full-catalog results must decide.

Queries use the existing card geometry with explicit whole-photo fallback and
all four rotations. Exact matrix search selects candidates without approximate
search loss; multiple faces collapse to distinct printing identities for reporting.
SIFT/RANSAC reranks the forty retrieved faces as a separate measured method.
Ground truth is used only to score results, never to prepare references or choose
candidates. The report records exact rank, top candidates, geometry, timings,
memory and both index/query identities. CPU/CUDA wheel build suffixes may differ
but framework releases, weights, code and preprocessing must match.

No method here automatically accepts a printing. Same-art variants, unreadable
stamps, OCR/image contradictions and missing references still require the planned
printing verifier. A short smoke run establishes execution, not recognition quality.

## Commands

From the repository, with Pillow installed for host download validation:

```powershell
python tools/acquisition-eval/catalog_references.py --catalog <frozen.jsonl.gz> --output <references>
python tools/acquisition-eval/catalog_snapshot.py --references <references> --output <references>/snapshot.json
docker build -t mtg-acquisition-visual-eval:local -f tools/acquisition-eval/Dockerfile.visual tools/acquisition-eval
```

The existing evaluation README describes initialization of VGG weights. Put the
pinned DINO source in `<models>/dinov2-source` and its verified weights in
`<models>/dinov2_vits14_pretrain.pth`. Model construction uses only these local
files. Do not download models inside a private-photo worker.

Inside the evaluation container, mount `/eval` (these scripts), `/models`,
`/references`, and `/photos` read-only; mount `/output` writable:

```text
python /eval/catalog_index.py --snapshot /references/snapshot.json --references /references --models /models --output /output --encoder dinov2 --device cpu
python /eval/catalog_compare.py --index /output/index.json --references /references --models /models --manifest /eval/android-expanded-manifest.json --photos /photos --output /output/comparison --device cpu
```

Use independent output directories for different encoders. `--limit 128` on the
indexer exercises interruption/resume without publishing a full snapshot. An
optional development image build uses
`--build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cu128`; GPU execution
also requires `--gpus all` and `--device cuda`. The default image stays CPU-based.
Use bounded container CPU/RAM and batch sizes; GPU hardware is not required by the
product goal. Do not overlap heavy evaluation with browser acceptance measurements.

CI runs `python -m unittest discover -s tools/acquisition-eval -p 'test_catalog*.py'`
without models, external requests or private photos. It covers resume, rollback,
source/model changes, corrupt data, path escape, committed-WAL snapshots, mapping
and honest partial/missing coverage. Real model and photo results must be recorded
separately after execution.

## Initial execution evidence, September 28

Fourteen reference/index integrity checks passed in local Docker without external
requests or models. The optional CUDA build completed. DINOv2 indexed 128 faces,
then resumed to 12,912 faces without recomputing the initial batch; the second run
took 289.01 seconds and published explicitly partial coverage. This is a subset
of the downloading catalog, not a chosen full evaluation pool.

The CPU-only evaluation image then queried one original Android photograph against
that index with networking disabled: 1,243ms for geometry/four orientations/image
retrieval, 8,722ms including forty-face SIFT reranking, and 867,008KiB peak process
RSS. DINO placed the correct Krosan Vorine printing first; SIFT moved it to second.
This is an execution smoke check, not an accuracy or full-catalog latency estimate.
It demonstrates that an additional reranker can worsen a result and must be
compared rather than automatically enabled. Full preparation, method comparison,
runtime image/OCR integration and printing verification remain unfinished.
