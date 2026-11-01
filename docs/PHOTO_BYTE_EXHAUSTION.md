# Real byte exhaustion during a photo write

## Current-main qualification — November 1, 2026 UTC

Main `7536ea516ad53348a3d69a1b5397dc3304330c02` adds the individually approved #991 photo-directory/root durability barriers to the actual file module. The unchanged verifier now also passes against that current module in immutable web image `ghcr.io/sefaction/mtg-archives-web@sha256:378eaaf2d39df939881d8f0f9820ba179b1dc346d416fff267f6249a645ee581`. Main `799e4b3aac625a6b7f05157734ac20943c801d57` adds only the approved #993 documentation corrections; its executable inputs and this module are identical. The image remains identified by its actual source `7536ea51`.

Actual module SHA-256 `f7f7aa5bc1ad39cf49f861028eac313e06eeedcb1cc90f8ac6361d0f727d8d2f` matches canonical Git and the image manifest. The manifest digest is `18cdaaf127fc2ad7364baa53cd4b2a381ab70445c9e149d668b7c96fae5a94a7`; its raw file SHA-256 is `a085e8e973724fef1ba9f6f18740fa60589b215c972883ed068e706b2f4394b0`. The verifier and host-refusal tests retain their original bytes.

After the full scanner-reference download terminated and released its own claim, a fresh, separately admitted window `scanner760-byte-current-20261031-01af2abb` ran three new isolated controls: image identity, both real kernel-byte-exhaustion variants, and populated-root refusal. Raw and preview again returned native `ENOSPC`/`write` after 16,384-byte partial writes, removed their partials without publishing failed photos, preserved their neighbor, and recovered/replayed exactly 1,048,576 bytes after deliberate filler removal. Their admitted/free/inode/filler measurements equal the explicit values below. The populated-root control preserved its exact neighboring bytes and created no filler or photo.

All three current-source controls exited zero, without OOM kills or restarts. Their exact owned containers were removed; the shared claim was released through its exact-owner release path. All four retained stopped containers' full configuration, host configuration, semantic mounts and state fingerprints were unchanged. No database, application service, browser import or production operation ran in this window. Earlier source `3484b2a0` evidence and its exploratory history remain separately preserved below. Required publication-head CI and individual PR #989 merge approval remain separate from this local runtime result.

## Preserved source3484 qualification and limits

Related to #305 and #310. Both remain open. The existing inode-full/server-loss verifier fails at temporary-file creation, while the existing partial-write control raises an injected error. This opt-in verifier covers a different, explicitly retained boundary: real filesystem capacity consumed between a successful free-space measurement and the subsequent write.

The unchanged published web image for source `3484b2a00601c8253a47e0789920352870b228f8` was used, pinned to `ghcr.io/sefaction/mtg-archives-web@sha256:863a6cd98d7a8e05684bb1562bae48ded225d875918a450a08928bb4513f0201`. No application, schema, storage threshold, quota or retry policy changes are made.

## What the verifier does

The [verifier](../scripts/verify-photo-byte-exhaustion.mjs) loads the complete actual photo-file module from the review image. It checks the module's SHA-256 against the image build manifest. Its only filesystem adaptations return a real `statfs` measurement after a separate filler write, and observe the partial file size immediately before normal unlink. No error code, partial write, free-space value or cleanup operation is fabricated.

On a new 3 GiB tmpfs, the measurement genuinely exceeds the unchanged 2 GiB admission threshold plus the 1 MiB payload. The filler then consumes all but 16 KiB before the photo write proceeds. The kernel writes those 16 KiB and returns `ENOSPC` from the native `write` syscall while more than 4,000 inodes remain free. This controlled interleaving models a capacity race; it is not a naturally observed production failure or a simultaneous-process benchmark.

Both raw and preview variants pass:

- The public write operation reports the real native error and removes the partial temporary file. No original/preview is published for the failed photo.
- A separate neighboring original retains its exact bytes.
- Removing only the filler permits a deliberate same-identity retry that preserves the exact 1 MiB payload. Replaying it preserves those bytes again.
- Exact fixture photos and filler are removed, and the fixture directory is empty afterward.

The final raw case measured 3,221,221,376 admitted free bytes and 4,092 free inodes after filling. The preview case measured 3,220,172,800 admitted free bytes and 4,091 free inodes. Both left 16,384 bytes available and observed a 16,384-byte partial file. The process exited zero without an OOM kill in a 4 GiB memory cgroup.

The verifier SHA-256 is `04606e35f7a1531ad78072aed37df41e4e1aba071be8b544a0e7c386dae529df`. The tested module SHA-256 is `487185cf714c4dadc22f8906d4e5055b97cd62d9d0da56c9010c18797210cf45`, bound by published-image manifest `5f92915ffd4d05859359f45b988829c55b40e393dd984857a653f307e8d70d7f`. Canonical tracked verifier bytes and raw host bytes are compared before publication; changing this verifier invalidates that recorded verifier identity.

## Admission and refusal

This intentionally fills about 3 GiB of temporary memory-backed storage. It never runs in ordinary CI or against an installation. Before starting it, the operator must hold the shared runtime claim, measure host/Docker memory and storage, and fence the full immutable ID of a newly created, sole-owned container. Do not reuse a retained container, database, upload directory or volume.

The tested container has a read-only root, no external network, two CPUs, a 4 GiB memory limit, 128 PID limit, a fresh `/byte-space` tmpfs with `size=3221225472,nr_inodes=4096,mode=0700`, and a separate 16 MiB `/tmp`. Its sole bind mount is the verifier, read-only at `/probe/verifier.mjs`. There are no persistent data mounts. Inspect image, owner/run labels, mounts, network mode and resource limits before starting; the script's internal checks do not replace this host ownership fence.

Inside that fenced image, set `MTG_BYTE_EXHAUSTION_TEST=1`, `MTG_LOCAL_PILOT_TEST=1`, `MTG_BYTE_EXHAUSTION_RUN=photo-byte-exhaustion-305-<unique-suffix>` and `UPLOADS_DATA_PATH=/byte-space`. `DATABASE_URL` must be the inert `postgresql://fixture:fixture@127.0.0.1:9/review_byte_probe?connection_limit=1`; no database is started or used. Run from `/app` with `node --import tsx /probe/verifier.mjs`.

The script refuses missing opt-in/local flags, alternate upload paths, a non-fixture database URL, a non-Linux/outside-image launch, external interfaces, an unbounded/wrong cgroup, a symlink or wrong filesystem/capacity, exhausted inodes, or any populated fixture root before its first write. Three normal host tests cover opt-in, alternate-path neighbor preservation and non-fixture URL refusal without exposing its password. A separate actual-image control populated the otherwise valid tmpfs with one neighboring file: the verifier refused, its contents stayed exact, and no filler or photo appeared.

All three owned exploratory/final/refusal containers exited zero without OOM kills and were retired after terminal receipts were saved. The exact runtime claim is released after cleanup. Four pre-existing stopped containers and mounts remain unchanged. The first exploratory raw-only probe is evidence of feasibility, separate from the final two-variant verifier; no failed run was hidden or counted as a pass.

## Limits

This qualifies the actual file-write, cleanup, deliberate retry and byte-integrity boundary only. Payloads are synthetic bytes under the file API's limit, not an image-decoding or upload-format test. Authentication, HTTP feedback, database records, browser behavior, server/database/host loss, EDQUOT, power loss, backup consistency, recognition, Inventory and installation/user acceptance are not qualified here. No 85-table conservation claim is made for this no-database control. Existing route/browser/inode/process-loss evidence remains separately bound, and broader #305/#310 acceptance remains pending.
