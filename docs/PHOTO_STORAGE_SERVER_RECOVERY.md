# Refused photo upload across web-server loss

Related to [#305](https://github.com/sefaction/MTG-Archives/issues/305) and
[#310](https://github.com/sefaction/MTG-Archives/issues/310). Both remain open.
This qualifies one explicitly remaining failed-storage-operation/process-recovery
boundary. It adds an opt-in browser verifier and repairs close-failure reporting
in its existing terminal helper, with no application, schema, storage policy,
retry policy or resource-setting change.

The existing #942 inode-full test already covers a real kernel ENOSPC refusal
and deliberate same-photo recovery. The separate #963 server-loss cases cover
Inventory transactions. Neither alone exercises interruption after an upload
has been refused by full storage. The new
[fixture](../tests/ui/acquisition-filesystem-restart.spec.ts) combines that
specific sequence without claiming every combination of failures.

## Qualified sequence

The production-mode app, PostgreSQL, browser and two regular synthetic owners
are isolated from existing installations. Both owners have a two-copy stock
row; the peer also has independent protected bytes on the upload filesystem.

1. Exhaust the 64 inodes of a new owned tmpfs. More than 3.22 GB remains free,
   so the unchanged 2 GiB byte-space guard passes. An actual browser upload
   receives kernel ENOSPC and the existing safe HTTP 409 storage-full guidance.
   Exactly one non-READY photo remains, without an artifact, candidate, job or
   acquisition receipt. No partial or original file was published.
2. Kill only the exact new web container with SIGKILL; verify exit 137 and
   unchanged configuration. PostgreSQL, browser, network anchor and the storage
   keeper remain alive. The keeper retains the *same* mounted tmpfs throughout:
   zero free inodes and the peer's bytes survive. Restart the same web container
   and verify its new lifetime and unchanged database records.
3. Require a deliberate retry while storage is still full. It fails again
   without another photo identity or any derived records. No automatic upload
   retry occurs after server recovery.
4. Remove only the fixture's empty fillers. A deliberate retry preserves the
   photo/slot/upload-key/digest and every other immutable photo field, saves
   exact original bytes, and creates one artifact, one candidate and one pending
   processing job. The acknowledgement replay and page reload add no effects.
   Both owners' stock and the independent peer bytes remain exact; no acquisition
   receipt is created.
5. Observe browser closure before cleanup. Attempt all owned photo removals
   before deleting recovery rows; a removal failure preserves those references.
   The relational tail is transactional. Compare every public table's full-row
   count and digest with its baseline, without exclusions.

## Results and bindings

- Final actual Chromium 1366/320 cases pass 2/2 in 55.9 seconds (27.4/26.0 seconds).
  Each case independently restores all 85 table fingerprints. Screenshots were
  inspected and the viewport overflow assertions pass.
- Final executed verifier SHA256 is
  `40e2754b8cc6428f3eae931f589408a2a02cead3822d07a97dba71297749900e`.
  Earlier pairs at 50.9/56.1 seconds retain their separate bindings. The 56.1-second
  pair added strict loopback-anchor/network/database-volume guards; the final
  pair executes the corrected browser-close helper described below.
- All 22 focused destructive-target/browser-terminal controls pass on Windows
  Node 24 and Linux Node 22, plus focused strict TypeScript. All six original test
  bodies remain exact; sixteen new cases cover falsy close rejections. The other
  target/terminal guard statements and independent file-cleanup helper remain
  unchanged.
- Application source is unchanged main
  `8deb01a75068713ecc41f900e0c8f292bc3a3631`. The production snapshot is
  `sha256:89420ad63881d889c4a90878e64822954eb1fc8ce629fcbb87ebd6497fedb7cd`.
  All 1,321 declared inputs match its exact LF Git export, manifest digest
  `c579bae386a1289e92b3ac72f100da653c09cc0e009848a1e9f4052c41c946ee`.
  All 1,321 files were also hashed in both the actual running web and keeper after
  qualification. Test additions are checked separately from this unchanged
  application snapshot.
- The snapshot uses Node 22.23.1, Next 15.5.25, Prisma 6.19.3 and Sharp 0.35.4.
  Its full production build, types and client-manifest checks pass. It was built
  offline over the existing dependency image; it is a local production-mode
  snapshot, not a claim that the multi-stage release Dockerfile was exercised.
  The disposable database uses PostgreSQL 16, with migrations applied normally.
- All 13 pre-existing primary service IDs/images/lifetimes/restart counters and
  configuration/mount hashes remain unchanged. This is service conservation,
  not a claim that a live background database had no legitimate changes.
- Across the build, three fixtures and the focused Linux check, fourteen owned containers,
  six sole-owned synthetic volumes and six empty networks are retired; exact runtime
  reservations are released. The current qualified
  image is retained for review, with compact source/failure/fingerprint records.
  No shared service, application data, unrelated volume or production resource
  was changed.

## Browser-close failure preservation

Author follow-up reproduced a failure in the shared terminal helper: if
`close()` rejected a falsy value such as 0 while `isClosed()` returned true, existing
callers' truthy-error checks recorded no failure. With unobserved closure,
cleanup stayed blocked but the original falsy reason could still disappear.
This is a controlled rejected-promise result, not an observed Playwright incident
or evidence of unsafe deletion.

The helper now wraps only falsy rejection reasons in an `AggregateError`, keeping
the exact original value in both its errors list and cause. Ordinary Error
identity, independently observed closure and all cleanup gates remain unchanged.
The original helper passes six controls and fails all sixteen new value/state
cases; the corrected helper passes 22/22 on both platforms. The matrix includes
undefined, null, false, zero, negative zero, BigInt zero, empty string and NaN,
with both observed closure states. No original assertion was removed or weakened.

The final controller helper SHA256 is
`e3a4b3237b783b1cdaa57317c576af90520c9e59462dddc445d7931c9eea3696`;
the unit-source SHA256 is
`b3ba8a8acb40795cccd9cfd4ccf419696b5cca88c93ffdab551102facbb99141`.
The final 55.9-second production workflow pair uses this controller helper and
the verifier hash above, restoring all 85 tables independently at each width.
Its server/keeper image remains the unchanged 8deb application snapshot; those
1,321 image-input checks are separate from these current controller-source
bindings. No additional application build was needed for a test-only correction.
New-head hosted CI and independent review are still required after publication;
the earlier 156c CI pass is not substituted for them.

## Preserved failures and limits

The first production build failed during types at an explicit 1536 MiB JavaScript
heap cap. That failure remains recorded. One fresh admission then allowed a
2048 MiB heap in the sole 2560 MiB build container; unchanged full types/build/client
checks passed. Test app/database/keeper/anchor limits were separately
1024/256/128/16 MiB. No application worker limit was increased. Anonymous registry
reuse was denied; no credential or authentication setting was handled.

The first two browser workflows reached recovery but failed cleanup because a
generated peer suffix violated the existing fixture-owner guard. Its rejection,
traces and screenshots remain failures. The corrected verifier generates an
independent UUID peer owner and validates names before seeding; the shared guard
is unchanged. After confirmed browser termination, exact owned fixture recovery
restored the original 85-table baseline before the passing run. A failed Windows
loader-path probe and read-only database role-name probe also remain recorded.

This is inode exhaustion at temporary-file creation, followed by controlled
web-process loss. It does not qualify block/byte exhaustion during partial
writes, EDQUOT, power loss, lost storage, database loss in this same sequence,
browser restart/in-flight-file persistence, online backup consistency or an
installed user workflow. The processing job intentionally remains pending;
native OCR, canonical preparation, recognition accuracy and Inventory commits
are outside this case. Historical incident causes, sustained resource acceptance
and the remaining #305/#310 requirements are not resolved.

## Repeating this specific case

Run only after exact ownership and task-specific capacity admission. The test is
Windows/Docker-Desktop-local and refuses endpoint overrides. It skips unless
`MTG_FILESYSTEM_RESTART_TEST=1`; ordinary UI/CI runs must not target an installation
merely to execute it. Default hosted CI does not execute this destructive case.

Prepare a fresh migrated database named `review...`, a production-mode web
snapshot, one private internal network and a distinct network anchor publishing
only loopback 13935. The web shares the anchor namespace. Mount a new labelled
local tmpfs volume into both web and keeper at
`/build/.local-data/server-loss-uploads`, with exactly
`size=3g,nr_inodes=64,mode=0777`. Never use a shared or previously populated volume.
The keeper must survive both web interruptions. PostgreSQL uses a distinct
sole-owned data volume. No native workers are started.

Supply the full immutable IDs through `MTG_INVENTORY_TEST_CONTAINER` (keeper),
`MTG_FILESYSTEM_RESTART_POSTGRES`, `MTG_FILESYSTEM_RESTART_NETWORK`,
`MTG_SERVER_LOSS_WEB`, `MTG_SERVER_LOSS_ANCHOR`, and the exact web image through
`MTG_SERVER_LOSS_WEB_IMAGE`. Supply the fresh database through
`MTG_INVENTORY_TEST_DATABASE`, the volume through
`MTG_SERVER_LOSS_UPLOAD_VOLUME`, a 32-hex nonce through
`MTG_SERVER_LOSS_NONCE`, and a unique `acquisition-server-loss-310-...` owner through
`MTG_SERVER_LOSS_RUN`. Labels and namespace/storage identities must agree with
the existing ownership helper and the new verifier. Set
`PLAYWRIGHT_BASE_URL=http://127.0.0.1:13935`, then run:

```powershell
npx playwright test tests/ui/acquisition-filesystem-restart.spec.ts --workers=1
```

Retain per-case lifecycle/before/after/screenshots and failed traces privately.
If any terminal or cleanup proof is missing, preserve the exact fixture for
owned recovery. Retire only its exact containers, verified sole-owned synthetic
volumes and empty networks; release the exact runtime owner after terminal
cleanup. Required final-head CI, independent review, individual merge approval,
deployment and user acceptance remain separate gates.
