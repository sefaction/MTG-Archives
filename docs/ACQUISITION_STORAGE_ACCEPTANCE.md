# Acquisition storage and recovery acceptance map (#305)

## Current boundary — November 1, 2026

This reconciles the retained P3 requirements with the fi-7160-only priority Brian
set on October 13. Ordinary scanner use is operator-accepted. Image storage,
privacy, recovery and explicit Inventory authority remain active. Actual phone
camera/library/HEIC/orientation acceptance and new capture methods remain deferred;
older phone-first planning does not make those current prerequisites.

The initial source anchor is main `78a017c82211a1b1d96de4c55213b6d460e2ad58`.
The publication integrates main `b3f4f37bda5ff4bbf688fa3e0f6dbd09e9b16794`,
including source-catalogue binding #995 and browser-test alignment #997. Neither
changes this upload/archive/restore path; integrated-head CI remains required.
Linked records describe their own tested revisions and limits. A test being
present on main does not establish that every installation or every failure
schedule passed it. Older “pending” or “unmerged” paragraphs in those records are
historical; consult the linked PR's actual merge and check records.

## Finite requirement map

| Retained requirement | Covering source and evidence | Disposition or exact limit |
| --- | --- | --- |
| Validated JPEG/PNG/WebP; bounded bytes and decoded pixels; useful unsupported-format feedback | [Photo verifier](../scripts/verify-acquisition-photos.ts), [private-intake validation record](CARD_ACQUISITION_VALIDATION.md), [upload controls](../tests/acquisition-upload.test.ts) | Existing software coverage; real HEIC/orientation/device acceptance stays deferred. |
| Private original and derivative retrieval; owner isolation; path and file integrity | [Photo verifier](../scripts/verify-acquisition-photos.ts), [photo isolation verifier](../scripts/verify-acquisition-photo-isolation.ts), [capture/restore route controls](ACQUISITION_CAPTURE_RESTORE.md) | Preserve actual owner/private-cache decisions. The composed route adapter replaces ambient cookie access, not stored-session policy. |
| Owner/batch quota serialization and storage reserve; blocked originals retained for recovery | [Storage policy](SCAN_PHOTO_STORAGE.md), [photo locking verifier](../scripts/verify-acquisition-photo-locking.ts), [limit controls](../tests/acquisition-photo-limits.test.ts) | Existing bounded coverage. Configurable allowances do not allocate disk or prove production settings. No new quota or reserve is proposed. |
| One upload identity survives retry, reordering and lost acknowledgement | [Upload recovery](ACQUISITION_UPLOAD_RECOVERY.md), [photo verifier](../scripts/verify-acquisition-photos.ts), [intake browser case](../tests/ui/acquisition-photo-intake.spec.ts) | Same key/slot/generation replays once. Equal bytes in a different physical slot remain a separate copy. |
| Identical photo files in distinct physical slots produce an advisory warning | [Matching-photo warning](ACQUISITION_MATCHING_PHOTO_WARNING.md), [counterexample controls](../tests/acquisition-photo-matches.test.ts), [real browser workflow](../tests/ui/acquisition-photo-matches.spec.ts) | Ready, unpurged current generations only; full authorized batch before display filtering. Equal files remain separate copies and never block review or Inventory preview. Similar-image detection, other batches and actual device acceptance are outside this check. |
| Location-bound count/slot admission; retakes retain physical identity; stopped capture drains safely | [Photo verifier](../scripts/verify-acquisition-photos.ts), [scanner storage browser case](../tests/ui/scanner-photo-storage.spec.ts) | Existing software controls; not an instruction to repeat accepted ordinary physical feeds. |
| File and containing-directory durability precede READY, including an existing-file retry | [Retry durability](PHOTO_RETRY_DURABILITY.md), [photo root barriers](PHOTO_STORAGE_ROOT_DURABILITY.md), [correction root barriers](CORRECTION_STORAGE_ROOT_DURABILITY.md) | Merged fixes #991/#984 cover the named directory barriers. Windows directory behavior and provisioned-mount/physical durability limits remain explicit. |
| Failed partial write/publication/directory sync and failed DB finalize never acknowledge a partial READY photo | [Storage-boundary controls](ACQUISITION_STORAGE_BOUNDARIES.md), [photo verifier](../scripts/verify-acquisition-photos.ts) | Injected I/O and transactional controls are established software evidence, not every natural fault or power-loss schedule. |
| Real capacity exhaustion after admission, with deliberate retry and neighbor conservation | [Kernel byte-exhaustion record](PHOTO_BYTE_EXHAUSTION.md), [byte-exhaustion verifier](../scripts/verify-photo-byte-exhaustion.mjs), [server recovery](PHOTO_STORAGE_SERVER_RECOVERY.md) | #989 covers actual byte exhaustion; the separate inode-full test covers creation refusal. Neither explains a historical production incident. |
| Actual process death leaves recoverable private temporaries, without broad cleanup | [Interrupted temporaries](ACQUISITION_INTERRUPTED_TEMPORARIES.md), [interrupted-storage verifier](../scripts/verify-acquisition-interrupted-storage.ts) | Exact owned SIGKILL controls cover before/after publication, same-identity recovery and legitimate purge. Historical installed remnants have not been globally searched or repaired. |
| Retention/Trash/pressure cleanup preserves unfinished or pinned work and retries partial deletion | [Storage-boundary record](ACQUISITION_STORAGE_BOUNDARIES.md), [pressure policy](SCAN_PHOTO_STORAGE.md), [retention race verifier](../scripts/verify-acquisition-retention-pin-races.ts) | Existing authority, pin and backup races remain bounded. No claim covers every possible concurrent schedule; no retention setting is changed. |
| Correction originals survive copy/read/barrier failures before accounting or source-pin release | [Correction original recovery](CORRECTION_ORIGINAL_RECOVERY.md), [root barriers](CORRECTION_STORAGE_ROOT_DURABILITY.md) | Existing named failure controls preserve immutable bytes and retry state; they do not establish physical power-loss survival. |
| Quiescent backup includes existing appdata and private photo bytes; restored ACK and commit replay are idempotent | [Composed capture/restore](ACQUISITION_CAPTURE_RESTORE.md), [actual verifier](../scripts/verify-acquisition-capture-restore.ts) | Existing JPEG/PNG/WebP, committed/pending, changed-payload, foreign-owner, old-credential and distinct-equal-byte controls remain. This is quiescent capture, not online backup. |
| Restore invalidates stale worker/catalog claims and restored credentials, preserving frozen reviews and receipts | [Restore drill](BACKUP_RESTORE_DRILL.md), [worker archive verifier](../scripts/verify-restore-worker-archive.ts) | Existing full-field projection controls retain their explicitly allowed transformations and exclusions. Do not call a count-only or normalized field comparison byte-exact. |
| A retained overflow photo, its saved review and its Inventory refusal survive the same archive/restore | [Composed verifier](../scripts/verify-acquisition-capture-restore.ts) | Actual local composed case passed; publication-head CI and review remain separate. See the bounded case below. |
| Browser/web/database interruption does not silently duplicate explicit Inventory writes or lose pending originals | [Server-loss record](ACQUISITION_SERVER_LOSS_QUALIFICATION.md), [database-loss record](ACQUISITION_DATABASE_LOSS.md), [failed-storage/server-loss record](PHOTO_STORAGE_SERVER_RECOVERY.md) | Existing named software boundaries; broader integrated release/installation acceptance remains #310. |

## Bounded overflow restore case

The November 1 review identified a missing precondition in the original case:
equal pre/post reviews could both be null or contain the same wrong decision.
The corrected verifier explicitly requires the intended non-null card, English
language, NONFOIL finish and NM condition before backup, then retains every
restored identity/review equality, write-free refusal and conservation assertion.
Earlier passing runs do not by themselves close that test-strength finding;
new-head actual execution and final review are required for this correction.

The original composed case explicitly contained one committed and one pending
copy. Its full-table comparison did not itself demonstrate a populated overflow
state. The extension creates three real uploaded photos in an owned synthetic
session, stops capture, then models a corrected target of two. The third photo
has an accepted saved review but remains physically outside the target. This
fixture state does not relax ordinary photo-slot admission.

Before backup and after restore, that third copy must remain overflow and refuse
Inventory preview. After restore, its identity and review must match, the refusal
must change no database row or appdata byte, Inventory must stay one copy, and
the ordinary pending copy must remain. All original credential, file, replay,
source-conservation and separate equal-byte copy assertions are retained.

Local qualification passed on source `3503d230344b6fa997a1cd22c1c33b0d25869fe4`.
The actual PostgreSQL 16/upload/archive/restore case passed in 2,753 ms with all
85 public tables compared under the original explicit restore transformations.
Four originals, one committed copy, one ordinary pending copy and one reviewed
overflow copy survive. Both restored acknowledgement replays, the original
credential/owner and changed-payload refusals, explicit commit replay and later
distinct equal-byte upload still pass. Overflow preview changes no row or file.
The original source's complete table/file snapshot remains unchanged.

Executed CRLF-export test SHA-256:
`28618dea1f4c8cab7ab088eb04aa2c32c5549b55683d582dd08902d6c1027ea8`.
The LF Git blob has SHA-256
`ec58af9b37620655f6e444b498c36224a91f1c776c031479f488692fd4b2e02c`;
an explicit comparison confirms line endings are the only difference.
The retained 62,504-byte archive has SHA-256
`e406be535e809269f14a2512089b616740cefbdab45de90ab94734084cb2cfb2`.
All 1,737 canonical Git inputs were checked before and after execution. The
immutable previously qualified image `sha256:7a761930ec61c25608635cdc936e4ce1b5011bb81533f96e862f194f2e272543`
provided dependencies and PostgreSQL archive tools; the verifier executed the
new source overlay. This is not a newly built application image. Schema/package
comparison permits only CRLF differences, the lockfile matches the pinned build
manifest, and the generated Prisma 6.19.3 schema hash remains exact.

Focused type checking inherits the original strict project compiler options and
passes for the verifier/import graph. A separate attempted full local check
exhausted its 1,536 MiB Node heap; it is retained as a failure, not a full local
type pass. Three earlier setup/type-option refusals and one preparation quoting
refusal also remain recorded. None reached the restore case. Full publication-head
CI and independent review remain separate requirements. An earlier 2,766 ms case
passed but its archive was not retained. The final case passed, then its controller
correctly retained ownership after the directory copy returned empty. Exact-owner
recovery read the verified archive directly, confirmed its local hash and completed
retirement. That original controller outcome remains failed; recovery is separately
recorded and does not relabel it as a passing orchestration run.

Both exact-owned roles exit zero without OOM/restarts; their temporary network is
retired. Four protected stopped containers match their full before fingerprints,
and the runtime reservation is released through its supported exact-owner path.
No application, schema, storage policy, backup mode or production change is made.

## Completion and remaining authority

This finite map replaces “exhaustive storage testing” as an unbounded next step;
it does not close #305. Finish integrated-head CI and review for the named overflow
case, and review the map against
the retained requirements. Any concrete additional uncovered requirement must
identify its boundary and existing owner before work expands. Preserve original
failures and never substitute a new passing case for their explanation.

Host provisioning, power-loss behavior and named-installation acceptance remain
unproven limits, not newly imposed P3 test requirements. Integrated release
acceptance remains [#310](https://github.com/sefaction/MTG-Archives/issues/310);
recognition/boundary accuracy remains #306/#307. Each PR still requires Brian's
individual merge approval. This document authorizes no deployment or operational
repair of an installation.
