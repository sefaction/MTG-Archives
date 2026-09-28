# Local image and OCR recognition runtime

This is an incremental batch for recognition issue #463. It extends the existing
acquisition jobs and review screen. It does not complete the accuracy goal or
enable production scanner acquisition.

## Development loop

1. Preserve original photos privately and label the expected printing before
   scoring. Keep repeated photos and derived rotations in their original group.
2. Prepare a frozen catalog, account for unavailable reference faces, and publish
   resumable indexes with catalog, model, transform and file digests.
3. Compare actual full-catalog image retrieval, SIFT reranking and saved native
   OCR. Replay their candidate union using the same policy as the application.
   Ground truth is used only for scoring, never to choose retrieval candidates.
4. Implement the measured change in the existing durable acquisition workflow.
   Preserve immutable observations and human review revisions.
5. Run the mechanical unit/database checks, build the actual worktree, verify
   loaded source provenance, and exercise real photos in local Docker at desktop
   and phone widths. Publish the evidence and its limits with a coherent PR.
6. Investigate the remaining failures and repeat. Individual merge approval is
   still required. A completed benchmark or PR is not completion of #463.

## Application sequence

- Existing intake reserves capacity, persists original bytes and prepares a
  preview. No second scanner-only artifact path is introduced.
- PaddleOCR continues reading title/footer regions in the existing worker.
- An independent CPU worker compares the same original against the complete
  published image index in four rotations. It also runs SIFT against the forty
  nearest reference faces. Raw image and SIFT candidates are retained separately.
  If localization fails, it compares the whole photo and reports that limitation.
- Existing catalog reconciliation waits for both observations. It looks up
  missing visual printing IDs and name/printing counterparts through the shared
  Scryfall metadata cache, then maps them to stable local Card identities.
- The union preserves explicit set/collector matches, prioritizes agreement,
  then interleaves remaining image and text candidates. It displays at most
  twelve suggestions and reports truncation. SIFT cannot erase the independent
  nearest-image candidate list.
- The existing side-by-side review displays the scan, prospective printing,
  alternatives and readable evidence. Pending/failed image comparison has its
  own status; saved photos and text suggestions remain available.
- Human corrections and confirmations stay authoritative. Inventory changes
  only through the existing explicit, capacity-aware commit.

## Conservative limits

Completed full-catalog development comparisons use 112,472 reference faces and
account for 899 unavailable faces. The combined candidate policy produced:

| Photo group | Photos | DINO + SIFT + OCR first / in twelve | VGG + SIFT + OCR first / in twelve |
| --- | ---: | ---: | ---: |
| Prior Android originals | 23 | 13 / 21 | 15 / 21 |
| Manual scanner originals | 17 | 15 / 17 | 15 / 17 |
| Additional Android originals | 28 | 27 / 27 | 22 / 22 |

DINO is the current local test encoder because it retained more expected
printings across these groups. VGG performed better at first choice in the prior
Android group; this is not a universal device/model selection result. Raw image
and SIFT retrieval differ, so both lists remain available to the union. The
[sanitized comparison report](../tools/acquisition-eval/full-catalog-comparison-results.json)
contains all eighteen union replays and input hashes. No photos or private paths
are included.

This hybrid batch does not automatically accept an exact printing. Similar
artwork, OCR agreement, embedding distance and SIFT inliers are candidate evidence,
not calibrated printing certainty. Existing offline stamp checks remain a
separate development prototype; the review screen still reports stamp and set
symbol as not checked. Finish and condition use batch defaults and overrides.

The initial complete index covers the frozen non-digital `default_cards`
snapshot and available faces, not every language or future printing. Unavailable
images are explicit. Metadata fallback is live; automatic reference/index
refresh and worker generation replacement remain follow-on work.

The development photo groups are not an independent held-out benchmark. These
comparisons overlapped other local work and do not measure isolated throughput.
Large-batch latency, resource use, restart recovery, further stamped pairs and
automatic acceptance precision remain required before the overall goal closes.

## Local setup and repeatable checks

Build `mtg-archives-web:local` from the actual cumulative worktree and
`mtg-acquisition-visual:local` with
`tools/acquisition-runtime/Dockerfile.visual`. Add `docker-compose.visual.local.yml`
after the ordinary local/acquisition/recognition layers. Supply absolute paths:

- `MTG_ACQUISITION_VISUAL_INDEX_PATH`: directory containing the complete immutable
  published `index.json` and generation files;
- `MTG_ACQUISITION_VISUAL_MODELS_PATH`: verified encoder weights/source;
- `MTG_ACQUISITION_VISUAL_REFERENCES_PATH`: verified public reference store.

Use the original local Compose project directory so its uploads and database
mounts remain the existing appdata. Do not rebuild from a stale primary checkout.
The optional overlay enables `ACQUISITION_VISUAL_ENABLED` on web and catalog
reconciliation. It does not change the Unraid files or production switches.
Model files, reference images, indexes and private photos are persistent mounts,
not image contents. The worker is CPU-only, bounded to one CPU and 3 GB. Its
native child receives no application database/session/backup credentials and
runs without internet egress.

Public reference downloads and immutable index publications use readable public
asset modes (files 0644, generation/image directories 0755). Temporary files stay
private until their bytes are validated. This fixes a live integration failure
where root-produced 0600/0700 assets could be evaluated as root but not read by
the restricted runtime. Private acquisition-photo permissions are unchanged.

Mechanical checks:

```text
npm run verify:acquisition -- --core
npm run typecheck
npm run verify:local-image
```

The owned three-photo browser check is
`tests/ui/acquisition-scanner-crop.spec.ts`. Set `MTG_LOCAL_PILOT_TEST=1`,
`MTG_ACQUISITION_VISUAL_TEST=1`, and `MTG_ACQUISITION_SCANNER_PATH` to the private
verified scanner corpus before running it. It exercises real OCR/image jobs,
catalog union, UI evidence, failed-image status, desktop/320px layout and zero
Inventory changes. It prioritizes only its disposable owner's jobs; it is a
functional acceptance check, not a throughput benchmark.

`scripts/benchmark-acquisition-recognition.ts` accepts `--visual`,
`--visual-index` and `--visual-method` (`visual`, `visual_then_sift`, or
`visual_and_sift`) in addition to the original saved-OCR/catalog/manifest inputs.
It verifies input provenance and complete coverage before replaying candidates.

## Remaining buildout

1. Runtime registered printing/stamp evidence with present, absent and unreadable
   outcomes, and contradictions that prevent automatic confirmation.
2. Automatic persistent catalog/reference/index maintenance and safe generation
   refresh without changing prior human decisions.
3. Independent accuracy material and realistic large-batch, CPU/resource and
   restart checks, followed by conservative automatic-acceptance validation.
