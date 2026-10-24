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

Ten focused actual-source controls pass without skips. The new disposable
PostgreSQL verifier creates generated real original/preview/private-marker
fixtures and a populated peer, fails the first database call, and checks later
real cleanup, ordered causes, missing-file replay, peer rows/files and full-table
restoration. Hosted acquisition CI invokes it before the existing verifier suite.
Exact local SQL results, final-head CI and independent review remain pending
until recorded on the PR; this draft report claims no unexecuted check.

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
