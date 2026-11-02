# Matching-photo warning for capture batches (#305)

## Delivered scope and limits

P3 Batch 2 originally required a duplicate-upload warning. The shared capture
view now says when the same photo file appears in multiple physical slots of
one authorized batch. The message asks the user to check for an accidental
repeat and explains that separate physical cards still count separately.
It never merges copies, changes upload identity, blocks review, or adds Inventory.

The counter uses existing progress metadata: SHA-256 and byte length of each
ready, unpurged current-generation original. It counts each physical slot once
across the full batch, before display filters and the initial twelve-card page.
A pending or replaced generation is excluded. Other batches and owners are
excluded by the existing authorized progress scope; no new API or database lookup
is introduced. This detects identical files, not similar pictures or identical
card names. A separately photographed copy need not produce a warning.

The component is shared with the current scanner capture workflow. Software
qualification below exercises its existing file-upload path; it does not revive
real camera/library/HEIC/device acceptance, add a capture method, or repeat
Brian's accepted ordinary fi-7160 operation. The remaining broad #305 and #310
acceptance is separate. This batch has no schema, worker, provider, count,
retention, reserve, permission, or Inventory-commit change.

## Source-bound author qualification — November 1, 2026

Application and unit source: `c4258a486a34d4bb829774cf71b4b23dacd4f308`.
Browser case and actual production build:
`6d4d980016f6abb05ba6c3c243fba49a6a26f27a`.
The later integration of main `4819029a36e674b23c9a1ba676211e60b25676a0`
adds only the already merged #992 load-test/documentation files; all four files
of this change retain their qualified blobs. Its exact-head CI is still a
separate requirement; the older build manifest is not relabeled as that head.

- Six counterexample groups pass: distinct physical slots and immutability,
  same-slot/replayed metadata, current/old/pending/purged retakes, a match at
  slot 300 beyond the first page, independent batches, and invalid identity.
  The focused original strict helper/test types pass.
- The standard Dockerfile passes the production build, full types, lint and
  client-manifest validation. The image is
  `sha256:fcede3dacf3178b5bcb41175ab7319e2975e2edc8083adb29e7930ef35dadbbb`.
  Its manifest matches 1,356 canonical build inputs, 502 copied source files
  match, and the production client contains the warning. Generated Prisma
  schema bytes exactly equal the canonical schema run through the image's
  pinned Prisma 6.19.3 formatter.
- The real browser case passes in 6.3 seconds (6.9 seconds total) against a fresh
  PostgreSQL 16 database and the actual production image. It uploads fifteen
  physical slots; the equal first/fifteenth files have distinct photo IDs.
  A deliberately lost successful upload response retries without another slot.
  Matching files in another batch and another owner do not inflate the count;
  the other owner's batch refuses access with 403.
- Two saved reviews produce an Inventory preview of two separate copies. Reload
  retains the warning and leaves Continue to Inventory enabled. A distinct
  retake removes the warning, keeps all fifteen slot IDs, and retains the old
  photo generation. No actual Inventory commit is submitted.
- The warning is visible without horizontal overflow at 1366, 390 and 320 pixel
  browser widths. Actual screenshots were inspected at all three widths.
  These are browser-layout checks, not physical-phone acceptance.
- Final fresh-instance conservation is three sessions, seventeen physical slots,
  eighteen photo rows including the retake, and zero Inventory. Both owned
  containers finish without OOM or restart; they and their private bridge are
  retired. All four pre-existing stopped environments have identical fingerprints,
  and the exact shared resource claim is released through the supported guard.

Private author evidence remains under this worktree's `.local-data/`:
`unit-result.json`, `review-b3a0bbf0/`, `image-probe-cli2-result.json`, and
`browser-36883734/` (workflow JSON, screenshots, logs, identities and final states).
No synthetic credentials, cookies or raw trace is published here.

## Retained failed test-setup attempts

No earlier failed attempt is relabeled as a successful run.

| Attempt | Observation and disposition |
| --- | --- |
| Initial canonical preparation | Windows rejected a drive-letter ESM import before any build/runtime. The private preparer now uses a file URL; the separate canonical preparation passed. |
| First image check and its diagnostic repeats | The build passed; raw generated-schema equality failed because Prisma reformats the source and orders model attributes. An attempted uninstalled formatter module also failed. The final check invokes the image-pinned CLI on a disposable copy and requires exact generated bytes; no schema assertion was removed. |
| First CLI probe guard | Docker exposes tmpfs in HostConfig before start, not in the created container's Mounts array. The exact never-started probe was inspected and retired; its ended controller and protected peers were checked before exact-owner release. |
| First browser fixture guard | PowerShell counted a wrapped null binding as one. The guard stopped before database startup. Only that never-started owned database and empty bridge were retired, with a recovery receipt and exact-owner release. |
| First actual browser workflow | The 256 MiB test tmpfs correctly failed the application's 2 GB free-storage reserve. That failed trace and receipt are retained. The fresh passing fixture used its own disposable writable container layer with measured Docker space; the application reserve and assertions stayed unchanged. |

## Delivery boundary

Author checks and local review do not constitute independent review, current-head
CI, a merge, a production update, or user acceptance. Keep this delivery in its
own PR; Brian's explicit approval is required for that individual merge and any
production change. No issue is closed by this partial #305 delivery.
