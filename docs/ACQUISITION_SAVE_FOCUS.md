# Acquisition saved-review keyboard focus

## Delivered scope

Issue #918 is one keyboard workflow remainder under #308. PR #919 is stacked
on separately reviewed #917 and requires its own approval after that dependency.
Successful same-card Save card review and Keep pending now reuse the correction
focus target: Simple Correct or Advanced Card name, after controls are enabled.
The effect leaves deliberate outside focus alone. Save and next retains the
existing next-card navigation. Review writers, defaults, revisions, quantities,
privacy, Inventory admission and draft/error handling are unchanged.

The flag is armed after a successful POST and the existing awaited reload.
That reload handles its own read errors; this change does not promise a new
successful-read guarantee or alter those pre-existing semantics.

## Actual negative and qualification

The pre-fix production client, including #917's Cancel repair, completed an
actual Simple/1366px Save through the review writer and displayed success, but
failed only the returned-Correct focus assertion. Exact owned cleanup restored
all 84 public-table full-row counts/hashes. Its trace and screenshot are retained.

On the source-bound repaired production candidate:

- Eight Simple/Advanced1366/320px Save and Keep pending cases pass: failed POST
  preserves the exact draft and saved state; a real successful writer preserves
  the expected choice or clears it for pending; same-card focus and the next
  keyboard action work; delayed real pending responses preserve outside focus.
  Inventory/commit state and original photo bytes remain unchanged.
- Four existing Cancel cases pass, preserving failed-read drafts, successful
  keyboard targets, outside focus, no decision writes and original photo bytes.
- Four corrected Simple/Advanced1366/320px Save-and-next cases pass with a real
  two-photo batch, failed-write draft protection and actual next-card row focus.
- Every case restores all 84 original table fingerprints and removes owned
  auth, acquisition records and original/preview files. Desktop/phone screenshots
  were inspected; these synthetic fixtures do not establish recognition accuracy
  or physical scanner operation.

The first 16-case run retained 12 passes and four fixture failures: its next-card
cases requested quantity1 and correctly could not reserve a second slot. Review
identified this; only those cases were changed to quantity2 and rerun. Product
admission was preserved. The initial failed attempts and their conserved cleanup
remain evidence, separate from the four corrected passes.

Six focused draft/navigation checks and changed-file lint pass. Exact final-head
CI is recorded in PR #919; incomplete checks keep the PR draft. Independent
source/evidence review is recorded there, separate from author runtime evidence.

## Build and source binding

Product/test head68b8dbf1016c642688a53e60c2b004a5b66508e5 was archived from Git;
all 1,230 actual image-manifest input hashes match that archive, digest
`e8f753fcd0285a37dd9ffcf31a6444ffef2d1a4353c3b64407689b9ebf88c27e`.
The local build used unchanged qualified locked dependencies from the #917 image,
with exact package/lock hashes checked, and compiled the complete archived source
in a dedicated 2GiB/no-extra-swap/one-CPU container with a 1536MiB Node heap.
Prisma generation, production compile/types/static generation and client-manifest
guards pass; OOM and cgroup max events are zero. Local duplicate lint was skipped;
changed-file lint and canonical Core CI cover lint. This is a bounded local recipe,
not a claim that the canonical Dockerfile itself ran locally. Final source differs
from the built source only by the explicit next-case fixture quantity correction
and this report; product inputs are identical. No redundant build is required.

An initial source-binding helper could not hash an empty tar-entry stream. Its
failed attempt is preserved; the corrected helper verifies all1,230actual inputs.
Private logs, manifests, traces, before/after pairs and exact resource identities
are under .local-data/save-focus-20261023/. Current review uses loopback13018;
prior #917 review/rollback remains on13017. Preserve current review resources;
retire only terminal owned build scratch after evidence is saved.

## Completion boundaries

Keep #918 and parent #308 open until the narrow resolving PR has Brian's explicit
individual approval and merges. #308 retains its other reconciliation, keyboard,
theme, stale-edit, long-batch and release requirements. No merge, deployment,
production data repair, scanner feed or independent human acceptance is claimed.