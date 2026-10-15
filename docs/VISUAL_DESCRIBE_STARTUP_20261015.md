# Visual describe startup qualification — October 15, 2026

Related issue: [#812](https://github.com/sefaction/MTG-Archives/issues/812). Source change: `56feb23e63c6381f38ecda15a3926590eeaa100c`; existing fixture adaptation: `84bbc76d1afb3621f84e37f69d4826dd56ea8b23`. This report describes a local author qualification, not production deployment, independent acceptance or a proven cause of the historical timeout.

## Change and measured boundary

`visual.py` previously imported `image_encoder` and `visual_compare` before `--describe`, loading Torch and Torchvision even though description only validates the published index and returns its identity. The source change imports the encoder when constructing the inference runtime and geometric adapters when processing a photo.

A bounded profile of the previous immutable local runtime completed in 19.634 seconds: the encoder import took 5.956 seconds and actual index loading/validation took 11.851 seconds. This identifies avoidable import cost; it does not establish the cause of the earlier 30-second timeout.

Full published-index validation remains: complete download, path containment, asset digests, matrix dimensions/type/finiteness and generation consistency. Descriptor identity still binds runtime source. Model weights, encoder identity, geometry, arithmetic/ranking, credential isolation, retry policy, resource limits and deadlines are unchanged. The source-bound descriptor digest intentionally changes.

## Regression controls and CI

- The guarded description control fails against the former eager import.
- Nine Linux descriptor controls pass: no inference imports during description, source identity binding, partial generation, changed assets, nonfinite vectors, shape mismatch, outside path, generation change, and controlled first/warm inference reuse.
- All 49 existing photo/manual-region controls pass after adapting the existing matching-module fixture to the deferred import. Pixel-isolation assertions are preserved and Torch remains blocked in that control.
- Initial source `56feb23` CI failed that fixture's former top-level patch target. The failure is retained in [run 38688465647](https://github.com/sefaction/MTG-Archives/actions/runs/38688465647). Test-only `84bbc76` corrects the fixture; all three required checks pass in [run 38688602365](https://github.com/sefaction/MTG-Archives/actions/runs/38688602365). CI for any subsequent report commit must be checked independently.

## Paired actual model control

One retained scan was processed in separate read-only, offline containers using the same public index, weights, CPU/resource settings and native environment helper. Each executed the actual describe command with its unchanged 30-second deadline, followed by a fresh native stream and two requests under the existing 120-second inference deadline. Native processes ran as UID/GID 65534, without application credentials. No database mutation or scanner operation occurred.

| Observation | Previous runtime | Candidate |
| --- | ---: | ---: |
| Describe wall time | 16.868 s | 5.823 s |
| First inference, including fresh stream startup | 44.274 s | 29.294 s |
| Warm inference | 4.818 s | 5.389 s |

Both first and warm responses match exactly after excluding elapsed time and the intentional source-bound descriptor digest. This includes photo identity, geometry, all candidate fields/distances/rotations/inliers, reference counts and `automaticAcceptance: false`. Descriptor fields differ only in `codeSha256` and `digest`; all 112,780 references, index identity, encoder and geometry identities match. Disposable cgroups record no max/OOM/kill events.

These are one-scan observations, affected by cache/order and host load. They are not a cold-cache benchmark, broad accuracy evaluation, performance guarantee, or proof that every parallel startup will meet its deadline.

## Cumulative local Docker window

A copy-only overlay preserves the exact previous image configuration and every base layer. Only `/app/tools/acquisition-runtime/visual.py` changes. The actual cumulative checkout includes the source and fixture commits on top of previous local review work.

- Visual image index: `sha256:68d312fba27aff7d8c088d475a5b5c704b8572714f9dcdc3e98c2d4919f403f1`.
- Its Linux/amd64 manifest: `sha256:c545899bfa9cf6a651d254082933866d5aa0bb49388b9f028b1cdfdae260617b`.
- Visual model descriptor: `3c183fee5b733b6272cfd6735f6ce376f5fb7e63d020a27fcc7b1a8af00eab0e`.
- Printing retains image `sha256:6f4c87e1f7cb5197dba852568f02ba26d2dbb1a86dcc12e1092c6ab6739e2112`; OCR retains `sha256:acb39102ae99eabcc554ffc82397a3ed8c9d7bddaac930c3e3306ce2f9da6635` and their existing model descriptors.
- Actual 332 application inputs match each native container, with cumulative 626-input digest `e48219dc6fc75347f29b9a396c65129294e1fc71d4aeaf7cbc3e62accee3841c`. Seven actual visual Python dependencies match the cumulative checkout. The unchanged web's 624-input digest remains `f12c4b44ff6726ba9afc5601c02eded60f5fb423b1ab433417b27d2af7d42bf0`.

After checking manual-worker inactivity, host processes and idle queues, exactly one simultaneous startup of the three review native workers ran. Container-start-to-ready times were visual 13.599 s, printing 3.429 s and recognition 34.557 s. These include bootstrap/preparation and are not describe durations. All three reported expected descriptors, zero native failures, zero init restarts, and fresh cgroup max/OOM/kill counters of zero. No retry/reload was used to obtain this result.

The first verification script nevertheless failed its image-label assertion: Compose records the Linux/amd64 manifest digest, while the candidate image index has a different digest. That failed script/result is retained. A read-only continuation independently verified both immutable identities and the container's `ImageManifestDescriptor`, then checked the same startup window. No service was restarted. Full Config fields and individual environment values match, except planned visual image/Compose metadata and generated hostname; recognition's environment array order differs but all values match. Exact original whole HostConfig hashes are restored by permuting only the visual four-bind and printing three-bind order; resource values and mounts remain unchanged. Unrelated image, environment and resource mutations are rejected by the guard.

All 16 primary services and four unrelated review services retain exact image, full configuration, mounts, container identity and lifetimes. Primary cgroup events remain unchanged, including existing historical primary printing OOM records. All 157 retained originals (904,889,236 bytes), entire review-upload manifest, catalogue projection (118,505 rows; 109,292 paper), 11 actual review table fingerprints and one explicit absent-table marker match before/after. Review jobs, capture, sessions, inventory and correction examples remain empty. Local review responds HTTP 200. The canonical Compose pointer changes only the visual image.

## Remaining scope and recovery

The original October 15 01:48 parallel TIMEOUT/SIGKILL remains a failed historical interval with unknown cause. The earlier aggregate Config evidence gap also remains failed/unknown. This source optimization and fresh passing window do not erase either record. Broad sustained/resource acceptance under #760 and unrelated historical availability/OOM investigations remain separate.

Private scripts, raw paired proposals, failed guards, immutable source/image proofs and conservation snapshots are retained under this batch's ignored `.local-data/visual-describe-qualification` directory. Do not publish private input images or raw authenticated output. No production, physical hardware, merge, issue closure or workflow-status change is part of this batch. Further costly qualification requires changed evidence or a specific unresolved acceptance question; do not repeat this successful window unchanged.
