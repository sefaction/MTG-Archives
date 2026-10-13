# GitHub issue organization audit - October 13, 2026

Live queue snapshot and metadata readback: 2026-10-13T18:21:38.322Z. GitHub remains authoritative; this is a recorded audit, not a permanently current dashboard.

Brian authorized direct issue organization and a draft documentation PR following the read-only audit. Scope was GitHub issue metadata and repository documentation. No application/scanner/container/database/host/production operation or PR merge was performed.

Documentation delivery: [draft PR #783](https://github.com/sefaction/MTG-Archives/pull/783). It remains draft for individual merge approval; the exact final-head required-check results are visible on that PR.

Prior local qualification figures below are author/reviewer reports and retained repository evidence, reconciled with live PR merge/draft/readiness metadata and comments. This task independently verified issue metadata and evidence distinctions; it did not repeat runtime qualification. Reported deployment and operator acceptance name only their recorded installation/scope.

## Before and after

| Measure | Before | After |
| --- | ---: | ---: |
| Open issues | 34 | 33 |
| Open issues without labels | 17 | 0 |
| Open issues with roadmap | 10 | 1 |
| Open issues with overloaded enhancement | 12 | 0 |
| Open issues with canonical type and status | 0 | 33 |
| Current non-deferred trackers | 0 | 11 |
| Deferred issues | 0 | 9 |

All 34 issues received a current summary and metadata readback. Nine titles changed to name their actual remainder. One completed issue (#506) closed after verified transfer of unresolved scope; no new issues were created and no other issue closed. Original bodies remain exact suffixes, all original comments are retained, all assignments and unrelated labels are preserved. Twenty labels were added; the fourteen existing repository labels were not renamed/deleted or globally repurposed. Legacy enhancement was removed only from this classified queue; future-only roadmap was replaced with deferred, retaining roadmap on #302.

## Exact scheme

[AGENTS.md](../AGENTS.md) requires independent type, workflow, area and scope/planning dimensions. Every open issue has exactly one type and status, and one or more areas. Roadmap identifies a coordinated top-level roadmap; tracker identifies umbrella/phase scope. Deferred is independent: #539/#542 remain bugs. Existing codex/claim/other metadata is preserved; labels do not grant locks, merge or deployment authority.

| Dimension | Exact labels |
| --- | --- |
| Work type | `type: bug`, `type: feature`, `type: improvement`, `type: maintenance`, `type: validation` |
| Workflow | `status: backlog`, `status: in progress`, `status: investigating`, `status: awaiting review`, `status: awaiting validation`, `status: needs decision` |
| Area | `area: recognition`, `area: scanner`, `area: review`, `area: inventory`, `area: data integrity`, `area: infrastructure`, `area: test infrastructure` |
| Scope | `roadmap`, `tracker` |
| Planning | `deferred` |

A phase retains its feature type while its remaining work is acceptance; a broad bug can carry tracker. Backlog means no current claim inferred; in progress can describe an actively progressing umbrella. Investigating means the cause is unknown and needs a bounded next test/stopping criterion. Awaiting review requires completed qualification and a ready PR. Awaiting validation names specific missing acceptance. Needs decision identifies a consequential unresolved choice. Closed #506 retains its improvement/areas but has no open-workflow status.

| Open issue work type | Count |
| --- | ---: |
| `type: bug` | 15 |
| `type: feature` | 13 |
| `type: improvement` | 2 |
| `type: maintenance` | 1 |
| `type: validation` | 2 |

| Open issue workflow | Count |
| --- | ---: |
| `status: awaiting review` | 1 |
| `status: awaiting validation` | 7 |
| `status: backlog` | 15 |
| `status: in progress` | 3 |
| `status: investigating` | 5 |
| `status: needs decision` | 2 |

## Saved filters

- [Current work](https://github.com/sefaction/MTG-Archives/issues?q=is%3Aissue%20is%3Aopen%20-label%3Adeferred%20-label%3Atracker): 13 issues at readback. Query: `is:issue is:open -label:deferred -label:tracker`.
- [Roadmap/acceptance](https://github.com/sefaction/MTG-Archives/issues?q=is%3Aissue%20is%3Aopen%20label%3Atracker%20-label%3Adeferred): 11 issues at readback. Query: `is:issue is:open label:tracker -label:deferred`.
- [Future work](https://github.com/sefaction/MTG-Archives/issues?q=is%3Aissue%20is%3Aopen%20label%3Adeferred): 9 issues at readback. Query: `is:issue is:open label:deferred`.

The three views partition the 33 open issues. They are saved links in AGENTS.md and #302, requiring no Projects-board access.

## Per-issue metadata changes

Labels below are literal GitHub names; all state transitions are shown. Every row also has a new top summary preserving the prior body and comments.

| Issue | Before labels | Verified after labels | State | Title |
| --- | --- | --- | --- | --- |
| [#302](https://github.com/sefaction/MTG-Archives/issues/302) | `codex`, `roadmap` | `area: inventory`, `area: recognition`, `area: review`, `area: scanner`, `codex`, `roadmap`, `status: in progress`, `tracker`, `type: feature` | OPEN | unchanged |
| [#304](https://github.com/sefaction/MTG-Archives/issues/304) | `codex`, `enhancement` | `area: data integrity`, `area: scanner`, `codex`, `status: backlog`, `tracker`, `type: feature` | OPEN | unchanged |
| [#305](https://github.com/sefaction/MTG-Archives/issues/305) | `codex`, `enhancement` | `area: data integrity`, `area: scanner`, `codex`, `status: backlog`, `tracker`, `type: feature` | OPEN | unchanged |
| [#306](https://github.com/sefaction/MTG-Archives/issues/306) | `codex`, `enhancement` | `area: recognition`, `area: scanner`, `codex`, `status: awaiting validation`, `tracker`, `type: feature` | OPEN | unchanged |
| [#307](https://github.com/sefaction/MTG-Archives/issues/307) | `codex`, `enhancement` | `area: recognition`, `codex`, `status: awaiting validation`, `tracker`, `type: feature` | OPEN | unchanged |
| [#308](https://github.com/sefaction/MTG-Archives/issues/308) | `codex`, `enhancement` | `area: inventory`, `area: review`, `codex`, `status: backlog`, `tracker`, `type: feature` | OPEN | unchanged |
| [#309](https://github.com/sefaction/MTG-Archives/issues/309) | `codex`, `enhancement` | `area: data integrity`, `area: inventory`, `codex`, `status: backlog`, `tracker`, `type: feature` | OPEN | unchanged |
| [#310](https://github.com/sefaction/MTG-Archives/issues/310) | `codex`, `enhancement` | `area: data integrity`, `area: scanner`, `area: test infrastructure`, `codex`, `status: awaiting validation`, `tracker`, `type: validation` | OPEN | unchanged |
| [#312](https://github.com/sefaction/MTG-Archives/issues/312) | `codex`, `enhancement`, `roadmap` | `area: scanner`, `area: test infrastructure`, `codex`, `deferred`, `status: backlog`, `type: validation` | OPEN | unchanged |
| [#314](https://github.com/sefaction/MTG-Archives/issues/314) | `codex`, `enhancement`, `roadmap` | `area: scanner`, `codex`, `deferred`, `status: backlog`, `type: feature` | OPEN | unchanged |
| [#442](https://github.com/sefaction/MTG-Archives/issues/442) | `codex`, `enhancement`, `roadmap` | `area: recognition`, `area: scanner`, `codex`, `deferred`, `status: backlog`, `type: feature` | OPEN | unchanged |
| [#443](https://github.com/sefaction/MTG-Archives/issues/443) | `codex`, `enhancement`, `roadmap` | `area: data integrity`, `area: scanner`, `codex`, `deferred`, `status: backlog`, `type: feature` | OPEN | unchanged |
| [#444](https://github.com/sefaction/MTG-Archives/issues/444) | `codex`, `enhancement`, `roadmap` | `area: infrastructure`, `area: recognition`, `codex`, `deferred`, `status: backlog`, `type: feature` | OPEN | unchanged |
| [#463](https://github.com/sefaction/MTG-Archives/issues/463) | none | `area: recognition`, `area: scanner`, `status: in progress`, `tracker`, `type: bug` | OPEN | unchanged |
| [#473](https://github.com/sefaction/MTG-Archives/issues/473) | `roadmap` | `area: scanner`, `deferred`, `status: backlog`, `tracker`, `type: feature` | OPEN | unchanged |
| [#498](https://github.com/sefaction/MTG-Archives/issues/498) | none | `area: data integrity`, `area: test infrastructure`, `status: investigating`, `type: bug` | OPEN | unchanged |
| [#501](https://github.com/sefaction/MTG-Archives/issues/501) | none | `area: inventory`, `area: review`, `area: scanner`, `status: awaiting validation`, `tracker`, `type: feature` | OPEN | unchanged |
| [#506](https://github.com/sefaction/MTG-Archives/issues/506) | none | `area: inventory`, `area: review`, `type: improvement` | OPEN → CLOSED | unchanged |
| [#539](https://github.com/sefaction/MTG-Archives/issues/539) | `roadmap` | `area: scanner`, `deferred`, `status: backlog`, `type: bug` | OPEN | unchanged |
| [#542](https://github.com/sefaction/MTG-Archives/issues/542) | `roadmap` | `area: scanner`, `deferred`, `status: backlog`, `type: bug` | OPEN | unchanged |
| [#557](https://github.com/sefaction/MTG-Archives/issues/557) | `roadmap` | `area: recognition`, `area: scanner`, `deferred`, `status: backlog`, `type: improvement` | OPEN | unchanged |
| [#558](https://github.com/sefaction/MTG-Archives/issues/558) | none | `area: scanner`, `status: backlog`, `type: bug` | OPEN | unchanged |
| [#565](https://github.com/sefaction/MTG-Archives/issues/565) | none | `area: infrastructure`, `area: recognition`, `status: awaiting validation`, `type: bug` | OPEN | recognition worker did not start on second batch. → **Recognition: verify restored production service completes subsequent batches** |
| [#579](https://github.com/sefaction/MTG-Archives/issues/579) | none | `area: infrastructure`, `area: recognition`, `status: investigating`, `type: bug` | OPEN | Catalog worker exits during local review fixtures; qualify deleted-source admission races → **Local workers: investigate historical exits after admission-race repairs** |
| [#692](https://github.com/sefaction/MTG-Archives/issues/692) | none | `area: data integrity`, `area: test infrastructure`, `status: backlog`, `tracker`, `type: maintenance` | OPEN | Audit remaining acquisition fixture teardown against the independent correction library → **Acquisition fixture audit: remaining cleanup qualification and conservation history** |
| [#714](https://github.com/sefaction/MTG-Archives/issues/714) | none | `area: infrastructure`, `status: needs decision`, `type: bug` | OPEN | Unraid: optional pricing archive maintenance restarts while opt-in is disabled → **Pricing maintenance: decide optional profile/autostart after deployed restart-loop fix** |
| [#721](https://github.com/sefaction/MTG-Archives/issues/721) | none | `area: infrastructure`, `area: inventory`, `status: investigating`, `type: bug` | OPEN | Public inventory: clearing all filters stalls the local navigation check → **Inventory loading: investigate historical unfinished streams after navigation fixes** |
| [#746](https://github.com/sefaction/MTG-Archives/issues/746) | none | `area: data integrity`, `area: recognition`, `status: needs decision`, `type: bug` | OPEN | Correction evidence: persisted finite geometry changes canonical hash and byte count → **Correction evidence: decide disposition of historical malformed bundles** |
| [#749](https://github.com/sefaction/MTG-Archives/issues/749) | none | `area: recognition`, `area: scanner`, `status: awaiting validation`, `type: improvement` | OPEN | Recognition: compare registered printing footer, symbol-area and frame details → **Recognition: validate calibrated shared-art printing discrimination** |
| [#755](https://github.com/sefaction/MTG-Archives/issues/755) | none | `area: infrastructure`, `area: test infrastructure`, `status: investigating`, `type: bug` | OPEN | unchanged |
| [#760](https://github.com/sefaction/MTG-Archives/issues/760) | none | `area: infrastructure`, `area: recognition`, `status: awaiting validation`, `type: bug` | OPEN | Recognition: investigate OCR and catalogue snapshot memory pressure under scanner batches → **Recognition memory: qualify sustained load after catalogue-refresh repair** |
| [#777](https://github.com/sefaction/MTG-Archives/issues/777) | none | `area: infrastructure`, `area: recognition`, `status: investigating`, `type: bug` | OPEN | Local review OCR worker exits with only a generic diagnostic → **Local OCR: investigate historical exit after sanitized diagnostics landed** |
| [#779](https://github.com/sefaction/MTG-Archives/issues/779) | none | `area: recognition`, `area: scanner`, `status: in progress`, `type: bug` | OPEN | unchanged |
| [#781](https://github.com/sefaction/MTG-Archives/issues/781) | none | `area: data integrity`, `status: awaiting review`, `type: bug` | OPEN | unchanged |

## Closure and acceptance reconciliation

- [#506](https://github.com/sefaction/MTG-Archives/issues/506) closed **completed** after the new [#308](https://github.com/sefaction/MTG-Archives/issues/308) summary/transfer was independently read back OPEN. Merged [#593](https://github.com/sefaction/MTG-Archives/pull/593)/[#596](https://github.com/sefaction/MTG-Archives/pull/596) fix the original next-action/stopped-navigation UX, and [#725](https://github.com/sefaction/MTG-Archives/pull/725) records Brian's October 10 independent acceptance of the visible Inventory action and clear final step, with exactly one real copy/receipt/audit and reload conservation. The closure comment links those PRs and every remainder.
- [#308](https://github.com/sefaction/MTG-Archives/issues/308) visibly carries unanswered full-run/count/uncertainty/overflow reconciliation, stale edit/destination/other-session/ordered-section behavior, desktop/phone/keyboard/themes and bounded long-batch review/reload/failure acceptance. Integrated release scale/throughput/recovery remains [#310](https://github.com/sefaction/MTG-Archives/issues/310), installation-specific acceptance [#501](https://github.com/sefaction/MTG-Archives/issues/501)/[#565](https://github.com/sefaction/MTG-Archives/issues/565), and accuracy [#463](https://github.com/sefaction/MTG-Archives/issues/463)/[#749](https://github.com/sefaction/MTG-Archives/issues/749). None is declared passed by #506 closure.
- [#304](https://github.com/sefaction/MTG-Archives/issues/304) remains open for exact current P2 integration/version/review-precedence/source-exhaustion/counter coverage reconciliation; delivered durable foundations are not repeated. [#309](https://github.com/sefaction/MTG-Archives/issues/309) remains open for the unique all-writer/rollback/replay/provenance/quantity/capacity matrix. [#501](https://github.com/sefaction/MTG-Archives/issues/501) remains open for named-installation and second-PC/production acceptance evidence, without assuming where the reported 1,000 scans occurred.
- [#305](https://github.com/sefaction/MTG-Archives/issues/305) retains storage failure/private backup-recovery scope; [#306](https://github.com/sefaction/MTG-Archives/issues/306) independently labelled boundaries; [#307](https://github.com/sefaction/MTG-Archives/issues/307) independent printing/language/rights scope. [#310](https://github.com/sefaction/MTG-Archives/issues/310) explicitly recognizes the historical scoped 150,000-copy/300-input [#638](https://github.com/sefaction/MTG-Archives/pull/638) pass and restored-claim [#656](https://github.com/sefaction/MTG-Archives/pull/656), preserving earlier failures and current integrated acceptance gaps. No foundation is reimplemented.
- [#442](https://github.com/sefaction/MTG-Archives/issues/442) explicitly retains deferred phone-library/HTTPS/permission/orientation/HEIC/admission/ACK, multi-card/manual/duplex-envelope and device/provider-reconciliation requirements from the phases. [#443](https://github.com/sefaction/MTG-Archives/issues/443) retains folder integration. Mixed active phases are not wholly marked deferred.

## Verified remaining-work distinctions

| Issue | Delivered evidence | Exact remainder/disposition |
| --- | --- | --- |
| [#714](https://github.com/sefaction/MTG-Archives/issues/714) | #720 merged and deployed; restart=no, opt-in refusal/exit1 and zero restarts on reported installation | Operator saved/active profile and autostart choice; Needs decision. Do not enable deletion to clear refusal. |
| [#721](https://github.com/sefaction/MTG-Archives/issues/721) | Public trigger #724 and bounded private loading #730 merged | Historical unfinished stream cause unknown; bounded recurrence evidence, unchanged deadlines. |
| [#746](https://github.com/sefaction/MTG-Archives/issues/746) | Prospective canonical persistence #747 merged | Historical malformed bundles preserved/unrepaired; Needs decision on provenance-preserving disposition. |
| [#777](https://github.com/sefaction/MTG-Archives/issues/777) | Availability restored, sanitized diagnostics #778 merged | Original 13:04 exit unknown; bounded sanitized recurrence evidence. |
| [#579](https://github.com/sefaction/MTG-Archives/issues/579) | Races #582/#586/#594 merged | Historical exits/visual retry remain unresolved; separate later storage correlation, no speculative attribution. |
| [#565](https://github.com/sefaction/MTG-Archives/issues/565) | Missing production service restored | All88 batch24 outcomes, review refresh and subsequent batch initiation evidence pending. |
| [#498](https://github.com/sefaction/MTG-Archives/issues/498) | Diagnostics #574/#595 and reproduced fixture-clock observation #669 merged | Historical initial claim uncertainty is distinct from actual correction-copy clock defect #781. |
| [#779](https://github.com/sefaction/MTG-Archives/issues/779) | Draft #780 development/CI evidence | Shared cumulative local four-image native/browser/conservation qualification pending; In progress, not ready. |
| [#781](https://github.com/sefaction/MTG-Archives/issues/781) | Ready #782 exact66557d9 local PostgreSQL/Docker/82-assertion workflow and three required checks | Individual approval/current-main integration/final checks/merge remain; Awaiting review. Prior completed-set approval excluded it. |
| [#749](https://github.com/sefaction/MTG-Archives/issues/749) | Registered detail/symbol/footer/layout tools merged | Calibrated independent same-art discrimination remains unvalidated; unsafe development ranking stays rejected. |
| [#760](https://github.com/sefaction/MTG-Archives/issues/760) | Bounded catalogue memory #761 merged, scoped67-input parity/resource qualification | Longer/more varied sustained accepted-image load under unchanged limits/pixels is pending. |
| [#755](https://github.com/sefaction/MTG-Archives/issues/755) | Historical build/API/worker-stall observations and recovery retained | No established cause; bounded passive evidence on an otherwise authorized build. |

Every investigation's current body gives a bounded next test and stopping criterion. A non-recurrence leaves history unknown. Next tests are proposals for subsequent authorized work, not operations performed here.

## Historical conservation evidence stays separate

[#692](https://github.com/sefaction/MTG-Archives/issues/692) remains open, with distinct records preserved and surfaced:

1. #737 first strict/prior-normalized account comparison failures have no established cause; a fresh substantive repeat does not qualify the earlier interval.
2. #739 historical-ready comparison failed because938 originals were previously purged;156 fresh survivor hashes do not claim preservation of the expired originals.
3. #740 strict evidence/account comparison failed, then exact reconstruction accounts for two valid SOURCE_JOB additions; that is a distinct explained delta, not a rerun erasing failure.
4. #774 separately retained its strict comparison and accounted for four valid additions through source/canonical/accounting reconstruction.
5. #746 historical numeric-payload/hash mismatch remains malformed and unrepaired; new-write prevention does not validate old bundles.

The original28 verifier candidates were an audit list, not28 proven failures. Merged scoped cleanup/failure-isolation work and original100/300 throughput/current-corpus/current-release acceptance remain differentiated; generated teardown data is not recognition or native throughput evidence.

## Boundaries, checks and resumption

- Read the Foundry hub and relevant autonomous workflow, roadmap and acquisition notes; reconcile with full live bodies/comments,100 recent PRs and15 foundation PRs. No checkout .agents skills were present.
- Primary checkout stayed on its original branch with its existing uncommitted checkpoint/manual/handoff files preserved. Isolated documentation branch: `codex/issue-organization-20261013`, based on main4a687c6. Shared scanner/runtime/test locks, owner states and other branches were untouched. Own issue-metadata lock was acquired exclusively and released only by its owner.
- Immediately before each edit, full live title/body/labels/state/assignments/comments/update time matched the captured baseline. Targeted label additions/removals and body-file edits preserved unrelated metadata. Every mutation was read back; #308 transfer was verified before #506 closure. Final open queue has no newly arrived issue outside the audit.
- Local documentation checks: complete34-issue coverage; exactly one type/status and at least one area for every open issue; exact old-body suffix and original-comment/assignment preservation; closed506 state/rationale and linked-open308 transfer; original AGENTS.md content preserved verbatim around the added section; explicit individual approval/safety/source-data policy retained. `git diff --check` passes.
- Readback/check recovery: the #506 closure was already completed when an assertion rejected the comment's trailing newline; exact live comment/file and completed-state readback verified it without a duplicate comment/close. Original AGENTS content comparison accounts for the normal Git LF versus Windows checkout CRLF representation; the Git diff contains only the added workflow section, with no existing-policy removal.
- Documentation-only change: no local Docker reload, dependency installation, physical tests, application/database tests, capacity inspection, host configuration or deployment was needed/performed. Existing GitHub Verify workflow checks the published documentation PR; its exact-head results are recorded on the PR. No publish/deploy workflow is triggered by this codex branch.
- Draft PR is for individual review/merge approval only. Remaining product blockers are the decisions and acceptance/investigation work above, not a reason to merge or deploy autonomously. [WORK_CHECKPOINT.md](WORK_CHECKPOINT.md) has this batch's branch, evidence location and next safe step.
