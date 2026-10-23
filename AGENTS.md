# MTG Archives Project Instructions

This is the canonical operating policy. Use [CODEX.md](CODEX.md) for commands, [the autonomous workflow](docs/AUTONOMOUS_WORKFLOW.md) for execution and handoff details, and [issue intake](docs/ISSUE_INTAKE.md) for triage procedures.

## Authority and current context

- Follow the current request's scope: an audit or plan does not authorize implementation. A later explicit user grant or restriction governs only its stated scope and duration; record its source and covered actions. Historical overnight permission creates no permanent merge authority.
- Default delivery is a feature branch and one PR per coherent batch, opened without further approval. Merge each PR only with explicit approval for that individual PR, unless a later explicit task-specific grant covers it. Green checks, another PR's approval and local review confer no authority. Do not push directly to `main`, bypass required checks or enable automatic merging under the default policy.
- Standing authorization covers local MTG Archives code, Docker components and snapshot data, including reset/restore testing. Verify exact targets and protect other active work and unique data. Production and unrelated resources require separate authority; narrower task restrictions still apply.
- Read the Foundry hub at `C:\Users\brian\Projects\Foundry-AI\20 - Projects\Personal\MTG Archives\MTG Archives.md` on entry; consult relevant linked notes when planning or scope changes. GitHub owns live issue/PR status; reconcile historical notes with it. If Foundry is unavailable, continue from repository/GitHub context and report that limit.
- Update Foundry only for durable decisions, milestones or operational/roadmap changes. Keep temporary commands and evidence in the repository/PRs. Never copy credentials, secrets or tokens into Foundry.

## Queue and delivery

- Honor explicit user priorities and urgent security/data-integrity fixes, then finish the oldest agreed human feature requests and bugs, respecting dependencies. Resume a coherent unfinished batch before starting another. Do not let new qualification tickets or broad audits continually displace user work.
- For human/unknown-origin requests, agree intent with Brian before enrichment or implementation. Reuse recorded decisions; ask only unresolved questions that materially affect scope. Keep the blocked decision visible and continue independent authorized work.
- Keep useful bug discovery: search open/closed issues and PRs for duplicates, record reproduction/uncertainty and impact, and link resolving PRs. Create a separate issue for independently actionable remaining work; keep incidental findings, failed harness attempts and evidence gaps with the existing issue/PR unless they need separate follow-up.
- Audit workflows, regressions and feature parity when requested, when a concrete risk warrants it, or when no eligible agreed work remains. Use a bounded question, next test and stopping criterion; use findings to improve the product. Preserve intentional role, ownership and public/private differences.
- Implement coherent batches, verify affected behavior and load cumulative product changes into local Docker for review when resources and ownership permit; identify included commits/PRs. Record a pending local review step if it cannot safely run, and continue eligible implementation. Documentation-only changes need static checks rather than a runtime reload.
- Keep scope and completion criteria visible. Close resolved issues after the resolving merge; a partial fix does not complete a broad tracker. Preserve original reports, decisions and failed evidence.

## Verification

- Run required exact-head CI and meaningful checks for changed behavior. Start with focused coverage; broaden for shared behavior, schema, security, data-integrity or concurrency risk and unresolved failures. Preserve applicable ownership, quantity, reservation, privacy, rollback and regression protections.
- Reuse passing evidence only when the tested inputs, environment and affected behavior remain applicable; record the binding and any limits. Rerun what changes invalidate. Independent review does not automatically require repeating successful costly tests; old-head results never substitute for required current-head CI.
- Verify affected product workflows in the review runtime, including desktop and relevant phone layouts. Distinguish author evidence, independent review, CI, merge, named-installation deployment and user acceptance; none implies another. A non-reproducing rerun does not explain a historical failure.

## Resources, ownership and handoff

- Assign work by measured node capability and authorized access. Before heavy work, check available memory/disk, active workloads and the proposed task's measured or conservative envelope; serialize heavy use of shared resources. If it does not fit, choose a smaller implementation/check or an already authorized isolated environment. The laptop remains an implementation node for work it can handle. Do not invent universal resource thresholds or interrupt jobs/increase shared limits as a shortcut.
- Brian's October 22, 2026 clarification supersedes the earlier blanket laptop heavy-runtime hold: continue implementation, local production builds, meaningful tests, Docker/app reloads and desktop/phone review on the laptop. Run builds when a change needs them, not continuously or at every scheduler tick. Admit one heavy operation at a time with task-specific memory and host/Docker storage headroom; a temporary capacity conflict defers that operation, not laptop development. Default to one acquisition-worker replica per active laptop environment, not the production server's replica count. Distinct catalog/OCR/visual/printing stages are not interchangeable replicas. Keep additional qualification pipelines on demand, after checking owners and durable queued work. Preserve active review, rollback, unique data and failure evidence while cleaning owned superseded artifacts.
- Use isolated branches/worktrees and one recorded owner per batch/shared-runtime mutation. Local locks protect only their named host/resource; labels and rereads are not a distributed lock. Re-read current claims/content before writes and defer conflicting or uncertain writes while continuing independent work.
- Hold a runtime lock only while owned work/children use that resource. Save a continuing pause or decision separately; after terminal cleanup, release through the supported exact-owner path. Recovery requires verified owner/child/process state and an authorized supported handoff/recovery path; record the previous identity. Age or an idle chat alone never permits takeover. Policy edits alone neither implement nor authorize recovery; see the workflow for unresolved ownership.
- At handoff, retire owned temporary processes/resources within existing authority. Keep active/current review and required rollback resources plus unique/unrecoverable source data and failure evidence. Preserve compact logs/manifests before retiring reproducible superseded images/caches/scratch copies; check references and other owners first. Local retention may be shorter than production retention. This is not blanket pruning or permission to delete application data/volumes or change retention settings.
- Keep a compact current section in `docs/WORK_CHECKPOINT.md`: branch/head, issue/PR, scope, owned resources, completed/pending checks, blocked decisions, evidence links and next safe step. Preserve historical context once under dated history or linked records; do not duplicate unchanged snapshots or bulk rewrite another worker's WIP. Reconcile with git, GitHub and actual process/runtime state after interruptions; never assume completion.
- Keep related desktop chats/scheduled work in the MTG Archives local project and verify project assignment through supported UI. Unattended local work requires the laptop awake, powered on, online and the app running. Verify scheduling before claiming it active; checkpoints do not schedule work.

## Product constraints

Design for roughly 150,000 physical copies, fewer unique printings, hundreds of locations, thousands of sub-locations and four users with uneven collections. Desktop has priority; key workflows must work on phones. Connections between installations for public cards/decks and visual storage/card representations remain roadmap directions.

## GitHub issue organization and upkeep

Public reporters need only a title and plain-language description; extra evidence is optional. Maintainers own internal labels and planning. [ISSUE_INTAKE.md](docs/ISSUE_INTAKE.md) holds label definitions, filters, origin receipts, concise enrichment and postmerge upkeep. A shared account, bot identity, prose or labels do not prove agent origin. Unknown origin follows human intent review; never manufacture a creation receipt or change origin through enrichment.

Use the explicit `triage: complete` label only after intent/readiness is established; sorting/assignment labels confer neither. Newly agent-created implementation issues need a verifiable creation receipt and complete applicable internal details at creation. The [advisory validator](.github/ISSUE_GUIDELINES.md) checks structure, not provenance, permission, evidence quality or acceptance; it does not assign labels or rewrite issues. Automation using `GITHUB_TOKEN` must call it directly or leave maintainer follow-up where GitHub suppresses subsequent events.

Use the [PR checklist](.github/pull_request_template.md). After an authorized merge, re-read affected issues/parents and comments, update current delivered/remaining scope with the merged PR/revision and evidence limits, preserve history and verify edits. Close only completed scope or visible transfer of every remainder with acceptance criteria and rationale; remove open-workflow status labels on closure. Do not overwrite concurrent edits or confuse merge with deployment/user acceptance.

Current capture priority is fi-7160 only. Brian's October 13 report of about 1,000 ordinary scans accepts ordinary physical operation; do not reinstate broad hardware qualification as a standing blocker. Independent recognition accuracy, software recovery, privacy and data integrity remain separate. Other capture methods/scanners, extended virtual-source validation, optional GPU and optional fi-7160 background/framing remain deferred. Respect declined counter rereads and specific settings/test deferrals. This policy creates no physical-operation or production authority.

## GitHub authentication

- Use the normal GitHub CLI browser flow: `gh auth login -h github.com -p https -w`.
- Complete the authorization in the browser, then verify it with `gh auth status` before pushing.
- The CLI process may remain open after the browser authorization succeeds; trust the follow-up status check rather than recording or handling tokens directly.
