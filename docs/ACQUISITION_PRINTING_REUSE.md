# Reuse of unchanged native printing observations

Audit batch 1 follows the recommendation in [audit PR #551](https://github.com/sefaction/MTG-Archives/pull/551).
It reuses printing observations only. Recognition routing, candidate retrieval,
reading zones, stamp interpretation, automatic confirmation and explicit Inventory
commit retain their existing behavior. Broader recognition issues #463/#307 remain
open. Issue #553 tracks the printing completion publication gap addressed here.

## Exact identity and durable storage

Every new completed printing job retains the exact native request identity:
server-established owner, original byte digest, full native descriptor, catalog
interpretation policy and the ordered Scryfall ID envelope actually sent to native
processing. The descriptor binds the runtime and registration sources, detector
policy, annotations, immutable index/reference manifest, reference availability,
OpenCV version/build, NumPy, Pillow and Python. An input change invalidates reuse.
The first upgraded descriptor is a new generation: eligible historical work is
refreshed once through normal queue scheduling. It is not a cache hit.

The worker looks up one completed job by an indexed exact key and verifies the
stored request identity and native response schema/provenance before reuse. It
also verifies the current original file digest even on a hit. Legacy jobs without
the full request envelope, malformed/oversized outputs or inconsistent identities
are misses. Unknown, conflicting and unavailable-reference evidence retain their
existing meanings. No historical observation or human review is rewritten.

There is no separate photo or result cache store. Reuse depends on retained job
history, survives worker restarts and whole-batch refreshes, reads at most one
bounded output, and keeps the existing 64 KiB per-job output limit. Existing job
history retention is unchanged; this is not a new global history-size cap. The
small identity/execution metadata is recorded alongside the output already saved
for every job. Removing a retained source naturally removes that reuse opportunity.

## Current job and publication authority

A hit supplies only native evidence. The worker reapplies the existing printing
interpretation to the current catalog proposals and card mapping. It binds the
new result to the current catalog job, instead of copying a previous proposal,
saved review or inventory decision.

Before and after lookup/inference, the worker verifies current catalog identity,
the claimed job/input/lease, candidate revision, review and exclusion state,
current physical generation, ready/unpurged photo, owner/user activity, session
phase and absence of receipt membership. Cancellation and abort still reject work.
The original raw-byte integrity check is never bypassed by reuse.

Printing completion locks the session and uses one atomic database publication
predicate for those mutable guards and the newest catalog source. It evaluates
lease expiry against the actual database clock, including time spent waiting for
the lock. Superseded inputs save no output; lost/expired leases have no publication
authority. These checks apply equally to fresh and reused native observations.
Other stages retain their existing completion behavior.

The observation's original `printingNative.milliseconds` remains unchanged.
`printingExecution` separately reports this execution's duration, reuse flag and
request count. The worker's aggregate logs count actual native request method
calls independently, including failed attempts. A reuse hit is not necessarily a
published result. No private photo, candidate or owner identity is logged.

## Acceptance and reproducibility

- `npm run verify:core`: generation, typecheck, all unit tests, production build
  and client manifest gates.
- `npm run verify:acquisition`: isolated PostgreSQL/file acceptance, including
  persisted reuse, owner/model/digest/candidate-membership/order misses, old-policy
  retirement, before/after/publication races, corruption, abort, lease loss/expiry,
  review/exclusion/generation/purge/cancel/activity/password/receipt safeguards and
  a catalog insertion immediately before the atomic completion statement.
- The model-free `test_printing_descriptor.py` changes each source, reference or
  dependency input and verifies a different native generation. Existing CI discovers
  it with the printing guards; the TypeScript reuse guards run in the normal suite.
- Opt-in local application replay:
  `MTG_LOCAL_PILOT_TEST=1`, `MTG_PRINTING_REUSE_TEST=1`, and
  `MTG_PRINTING_REUSE_RESTART_TEST=1` for the persisted worker-restart check, with
  `MTG_ACQUISITION_NEW_SCANS_PATH` pointing to the private, digest-verified original
  scan corpus; run `tests/ui/acquisition-printing.spec.ts` serially. Each fresh result
  is followed by a new catalog job with identical native inputs. The real durable
  queue, restricted Python worker, completion path and browser are used. The test
  asserts identical serialized native evidence, printing summary, proposals and
  OCR observations, zero inference on reuse, review-only behavior, desktop/phone
  layouts, preserved originals, failure fallback and no Inventory writes. The
  failure fixture is explicitly tied to the newest catalog source.

Private per-run logs, originals and observations remain ignored under `.local-data`
and `test-results`. Timing includes the existing queue; native work avoidance does
not by itself establish end-to-end or population throughput.

## Measured local application results — October 1, 2026

The final replay passed against the loaded application and restricted native worker,
using four paired observations from three retained original scans. One original
is exercised as both a photo and a declared card scan. These are correlated
development fixtures, not independent held-out accuracy or throughput samples.
Each fresh observation used native inference; each subsequent catalog refresh
reused its persisted observation. Native evidence (including uncertainty and original
timing), printing summary, ordered proposals and OCR output were deeply equal.
The first reuse occurred after restarting the actual printing worker.

| Pair | Fresh native inference (ms) | Fresh handler (ms) | Reuse handler (ms) | Reuse inference requests | Catalog refresh to publication (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1, worker restarted | 8,508 | 8,537 | 135 | 0 | 3,717 |
| 2 | 8,288 | 8,324 | 28 | 0 | 6,961 |
| 3 | 8,268 | 8,306 | 27 | 0 | 7,790 |
| 4 | 8,874 | 8,926 | 29 | 0 | 7,360 |

Median handler time was 8,430.5 ms fresh and 28.5 ms reused. This measures printing
handler work, including reading and verifying the unchanged original, database
lookup and current-input fences. It excludes queue admission and other recognition
stages. Median refresh-to-publication was 7,160.5 ms; queue scheduling remains
material even when inference is avoided. The restarted-worker reuse took 135 ms.
The worker's independently counted request-method logs also recorded completed
reuse hits with zero requests. The original `printingNative.milliseconds` is not
relabeled as the duration of a reuse execution.

The same replay passed desktop 1366px and phone 320px review/original-image checks,
fixed reading-zone assertions, current-source failure fallback, and zero fixture
Inventory writes. Its owned users, sessions and original files were cleaned up.
The isolated PostgreSQL acceptance verified these boundaries independently:

| Requirement | Evidence |
| --- | --- |
| Persisted valid reuse | Three successive current catalog jobs published identical native/summary/proposal/OCR evidence with zero request calls. |
| Relevant input invalidation | Owner, descriptor, original byte digest, native candidate membership and order changes invoked fresh inference. Policy mismatches retire; each descriptor source, manifest, annotation and dependency identity change yields a different generation. Legacy, forged, malformed and oversized records miss. |
| Current-job and review protections | Candidate revision/review/exclusion, physical generation, purge, cancellation, owner/user activity, password reset and receipt membership changes reject before lookup, after lookup and at publication. |
| No stale publication | New catalog after handler, during lookup and immediately before the atomic UPDATE leaves output null and returns SUPERSEDED. Input mutation and owner changes also reject; expired/lost leases return STALE_LEASE, even with an earlier caller timestamp. Abort and corrupt originals reject. |

Core verification passed 759 unit tests, typecheck, production build and ten client
manifest guards. Disposable PostgreSQL acquisition/import acceptance and model-free
native descriptor tests passed. Native registration and detector algorithm files
were verified byte-identical to the existing local native image.

The broader serial browser run recorded 85 passes, 14 prerequisite-gated skips
and five failures. Three were obsolete test expectations (singular preparation
wording, automatic incremental paging and a 24-route census for the current
25-route app); one lacked its required installer-path fixture; one was intermittent
Inventory audit-dialog focus restoration. All five cases passed on isolated
follow-up replays: three used ignored test-only corrections, the installer check
used the retained validated binary, and the Inventory test was unchanged.
The original broad run remains non-green. Test maintenance is tracked in
[#554](https://github.com/sefaction/MTG-Archives/issues/554); the intermittent focus
observation remains open in [#555](https://github.com/sefaction/MTG-Archives/issues/555).
The replay corrections do not alter this PR's tracked application or tests.
The broad suite also exercised 150,000 copies, 15,000 Inventory rows, 2,200
locations and four uneven owners, with owned scale-fixture cleanup verified.

Final preservation matched baseline fingerprints for 883 retained original files,
884 photo rows, 76 saved reviews, 10,280 Inventory rows, one commit and five receipt
members. All 10,736 pre-existing audit rows matched their baseline fingerprint.
Seven independently verified orphaned regression-fixture audit entries were cleaned
up; two deliberate account-theme audit events from the broad suite were retained.
No printing fixture users or sessions remain. Detailed fingerprints and per-run
evidence remain private in ignored local data.

Loaded web image:
`sha256:cedfe224d7ac4b6bdacc66abed4729ff70956bd2479152c4fb1b3809f345bcd2`.
Its 506-file source manifest matched this worktree, digest
`d51f32efcbbce592e6185f345c62f9f24ca56c8eea9199b7a9b194c50817222a`.
Loaded printing image:
`sha256:d31b9a96c2e257c23a5ba4b2730103fbc323ac93f12e3765444441ee52557196`.
Native generation:
`9aefff89f02e7e4b4decd888c4b3bbd4ffdb987a551dbd4f0558cfb0b67d4ee0`.
The reuse index is installed locally. This build starts from approved main
`e247916`; audit PR #551 is an independent documentation/tooling reference.
The existing local original/model/reference mounts and reviewed installer are
retained. Recognition/visual workers remain on their existing native images.
