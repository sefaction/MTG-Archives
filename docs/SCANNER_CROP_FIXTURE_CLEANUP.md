# Scanner-crop fixture cleanup

Issue #970 is a bounded follow-up to #692/#310. The original first feedback
database call ran before `try/finally`, so its failure skipped both the legacy
source/file teardown and final sweep. A later final-sweep error could also
replace a legacy failure. Eight actual-source sequencing probes reproduce both
behaviors on main9b3add47 and ready969f8bd9e3f. Database doubles establish control
flow only; they do not establish SQL residue or a historical incident cause.

The helper now validates the exact fixture owner before any action, independently
attempts the same three actions in their original order, and retains every
cleanup cause. The existing Playwright owner fixture records a workflow failure
and passes its actual value to cleanup, preserving primary and cleanup causes
including falsy throws. Healthy cleanup preserves the original workflow outcome.
The existing needsCleanup guard and independent fixture clock remain intact.

The complete ordinary workflow, assertions, stage deadlines and legacy SQL/file
template are unchanged. PR #969's inner file-phase repair is separate; this
wrapper is compatible with it and does not claim to repair arbitrary SQL errors.
No application, retention, recognition, Inventory or hardware policy changes.

Ten focused actual-source controls pass on the host and locked dependency image,
without skips. Exact source911b6203/archive64fbabff passes the disposable real
PostgreSQL/filesystem verifier and focused types in50.12seconds, exit0/noOOM.
Generated real original/preview/private-marker fixtures and a populated peer
qualify a controlled first-call refusal, later real legacy/final cleanup, ordered
workflow/cleanup causes, missing-file replay, exact peer rows/files and restoration
of all85 public-table full-row fingerprints. This injects a call-boundary error;
it does not simulate a persistent database outage. Locked package/lock/schema
hashes match the reused dependency image before the source archive is extracted.

All nine source911b checks in Verify40093270788 pass. Actual hosted acquisition
120870446774 executes the new case and independently restores all85 table maps.
Core120870446797 passes1670 unit cases/one existing Windows-helper skip, full
types/build/client guards and27 issue-guideline checks. Hosted logs are bounded;
the complete new case and its full conservation pair are present and inspected.
The outer repair is hosted alongside the unchanged existing acquisition suite.

Independent review then found that the source adapter omitted the actual
file-helper binding introduced by969. The clean text merge alone did not prove
execution: its actual composed source raised ReferenceError and skipped the
legacy action. The original failure and review are retained. Correctede35b8b8e
binds the real optional named exports, supports aliases and refuses missing
exports before any database query; an eleventh actual-source regression covers
that integration boundary. Independent re-review repeats the real composition
probe rather than treating the prior standalone checks as sufficient.

All nine corrected e35 checks in Verify40093855062 pass.
[Independent correction review5638237099](https://github.com/sefaction/MTG-Archives/pull/971#pullrequestreview-5638237099)
confirms the actual composed source, ordered causes and pre-query missing-export
refusal, with no remaining source finding. The original P2 thread is resolved
with both the failure and correction retained. Final report-head checks and any
remaining independent evidence review stay separately recorded on the PR.

Corrected local evidence is separate: e35/archivee3980e7c runs11 controls, then
loads exactly the crop spec and shared helper from composed treee3c9212d
(e35 plus ready969f8). Both overlay hashes are checked before use. Actual
composed PostgreSQL/filesystem cleanup, peer/replay/all85-table equality and
focused types pass in46.18seconds, exit0/noOOM. These two files are explicit
qualification inputs; no whole-feature-tree runtime claim is made for that
composed execution. Earlier standalone911b evidence retains its original scope.

Only the helper and existing owner-fixture wrapper change in the original spec:
every other byte after newline normalization, all78 original expectation
expressions, stage/fixture clocks and the complete legacy SQL/file template are
exact. A synthetic merge composes this with ready969 unchanged. Its first attempt
exposed an additive runner-call conflict; moving the new call after existing
snapshot coverage resolves that conflict without changing either verifier.

Each qualification's two temporary containers, sole disposable database volume
and internal network are retired after current counts match all85 baseline
counts, zero other database clients and exact ownership/reference checks. Both
exact runtime claims are released. Existing reviews, shared images and data are
preserved. An initial
private mapping harness assumed every file repair used the same shared export;
its binding refusals preceded the eight successful source sequencing probes and
are retained. No application or test assertion was relaxed.

Final report-head CI and independent review are recorded on PR #971 before
readiness. Report-only changes reuse the explicitly bound e35 composition and
earlier standalone evidence;
they do not claim that a later complete source tree was loaded into this image.

The original 28-candidate audit maps to21 original fixtures in ready969,
three in ready965, one in ready967, one in merged957 and two metadata-only
fixtures with no direct source-file phase (dashboard/alignment). Ready969 also
covers three later fixtures. This inventory does not complete the broad audit:
the uncovered crop outer boundary became970, and ordinary/native/optical,
independent accuracy, current sustained scale and historical conservation
failures keep their separate evidence and acceptance requirements.

Test infrastructure requires no app build or desktop/phone reload. The unchanged
ordinary optical browser scenario is not run by the generated cleanup verifier.
No physical feeding, production, deployment or independent user acceptance is
claimed. Individual approval and an explicit merge request remain required.
