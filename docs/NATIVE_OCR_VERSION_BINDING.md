# Actual CPU OCR version binding (#304)

This opt-in qualification covers the real OCR stage behind the generic P2
version/replay contract. It uses the canonical recognition Dockerfile, its locked
public models, real native stream and production upload, canonical preparation,
queue, handler, completion and review functions. Native output is not mocked.
The source image and catalogue are synthetic; this is not recognition accuracy,
full-catalogue retrieval, physical scanning or broad P2/release acceptance.

## Covered contract

- Two distinct photo slots retain the same original JPEG bytes and separate
  durable photo/job identities.
- The real descriptor identifies all twelve initialized model files, package
  versions and runtime source. Native preparation uses its normal 30-second
  deadline; processing retains 45 seconds and a 90-second lease.
- A catalogue-only edit changes the resolution snapshot without creating a new
  raw OCR attempt. Saved input retains the admission snapshot; output identifies
  the actual newer catalogue/index used for resolution.
- Actual model text evidence and its original-photo/model identities survive
  durable job completion. A human review supersedes late actual native output.
- A detached model copy differs by one byte in one weight file. The normal model
  verifier refuses it. Its actual descriptor is different; an incompatible
  configured worker refuses that job before native work, an incompatible native
  result is refused before publication, and preparation refuses the wrong
  expected descriptor. This is a corruption/version control, not a second
  accepted or trained model.
- Originals stay exact, Inventory and commit counts stay zero, and exact-owned
  cleanup restores every initial public-table row fingerprint.

Refusal assertions are checked outside `runAcquisitionJobsOnce` as well as inside
the handler, so its normal failure handling cannot swallow a failed test and
turn it into an expected failed-job result. Cleanup retains the primary cause,
attempts native shutdown and database disconnect independently, and removes
owned files only after native termination and successful row restoration.

## Isolated invocation

Use a new owner-labeled internal Docker network and empty PostgreSQL 16 database
named `acquisition_native304`, with alias `native304-pg`, generated fixture-only
credentials and no published ports. The script additionally refuses another
host/database or pre-existing users, cards, Inventory or acquisition sessions.
It is not an installation diagnostic or a general fixture-reset command.

Build `tools/acquisition-runtime/Dockerfile` from the selected source and initialize
a new private `/models` mount with `download_models.py`. Only setup needs network
access. Keep that verified generation read-only for inference. Make a detached
copy at `/models-changed`, flip one byte at offset 32 in
`en_PP-OCRv5_mobile_rec/inference.pdiparams` under its versioned `official_models`
directory, and retain both original/changed hashes. Never alter the valid mount.
Check the detached copy with `download_models.py --verify-only`; expect a model
integrity refusal before any native inference.

Run one recognition container with both model roots mounted read-only and only
the private database network. Retain the ordinary 2 GiB/one CPU/no-extra-swap
worker envelope. Its owned upload directory needs the application's unchanged
2 GiB free-space floor; a small tmpfs intentionally fails that check.

Inside that container, using the generated private `DATABASE_URL`:

```sh
node node_modules/prisma/build/index.js migrate deploy
MTG_NATIVE_OCR_VERSION_FIXTURE=1 node node_modules/tsx/dist/cli.mjs scripts/verify-native-ocr-version-binding.ts
```

The changed-root descriptor control only redirects the actual descriptor
function to the detached files. It hashes their real bytes with the unchanged
algorithm and packages; it does not invent a model digest or synthesize native
output. The application catalogue is deliberately small and local, and this OCR
stage does not bypass the visual runtime's complete-index requirement.

The final JSON reports bindings, real request/text counts, publication/refusal
results and restored table count. Preserve failed attempts and compact identity,
source/model/file and cleanup receipts before retiring only the exact owned
containers/network. Do not prune shared resources or change existing data.

## Author evidence and remaining scope

The actual Linux case produces three text lines from the readable synthetic
78,792-byte JPEG, completes one job, retains a human review against late output,
and passes both model-result and preparation refusals. Three real native requests
are made; no Inventory rows or commits are created. All 85 initial public-table
fingerprints are restored, including the migration history, in the isolated
base-main fixture. Catalogue digests vary with deliberately random fixture IDs.

The model digest is `f40093b83e51f813f0fd70e64e65d1eae51234a3a9f89c0397ea34fda4391405`;
the one-byte copy gives `03865197180d20ac2cf6d454fb93fde59a9b436c402b1e0c3ebc7999367cad6a`.
Packages are Paddle/PaddleOCR 3.2.0, PaddleX 3.2.1, NumPy 2.2.6, Pillow 11.3.0
and contrib OpenCV 4.10.0.84. The input digest is
`95444a7c21775e2a901109479f1b3d17245e10c7f8418228d125869e968369e1`.
The final image was built from a Git archive of main
`932e305c2721c2ede97a6c8aebb84e9d7b9953a8` plus this qualification script.
All 495 copied source files were hashed against that export inside the image,
with no mismatches. This avoids treating Windows checkout line endings as
identical to Git bytes. The final qualification script SHA-256 is
`52be12347a5d2d4ecf0292da8c26cdb5a03addd7181d706eb2ffb23fa8d9d8b9`.
The exact image, current-head CI and terminal cleanup are recorded on the PR;
earlier partial qualification does not establish those gates. This documentation
is not copied into the native image and does not change its tested inputs.

The initial private harness used top-level await under CommonJS and failed before
native work. Its wrapper correction passed. The first SQL fixture correctly
refused a 256 MiB upload tmpfs because it lacked 2 GiB free; ordinary owned
container storage preserved the guard. Both failed logs remain separate from
passing evidence. Review also moved refusal assertions outside the worker catch
boundary before final qualification.

This advances one actual stage. Visual/printing model/index integration,
independent held-out recognition/geometry, sustained resources, recovery,
installed-helper deployment and user acceptance remain with #304/#306/#307/#310
and existing owners. Ordinary fi-7160 operation and GPU/provider deferrals are
unchanged. No source/runtime algorithm, schema, model, recognition threshold,
Inventory writer, production configuration or merge is changed by this batch.
