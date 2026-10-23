# Autonomous development workflow

## Current execution loop

[AGENTS.md](../AGENTS.md) is the canonical policy; [CODEX.md](../CODEX.md) is the Windows command reference. This guide describes execution, not additional authority. Later explicit task-specific grants/restrictions apply only to their stated scope and duration. Historical approvals, setup observations and schedules below are not current permission or live status.

1. Reconcile the current request, git/worktree changes, live GitHub issue/PR status and existing owners. Read the Foundry hub on entry and relevant feature notes when planning or scope changes; reuse already read, still-applicable context. If unavailable, continue with repository/GitHub evidence and report the limit.
2. Resume the unfinished coherent batch. Otherwise honor explicit user priorities and urgent security/data-integrity fixes, then take the oldest eligible agreed human feature request or bug, respecting dependencies. Use original issue creation time, not latest bot-comment activity. Follow [ISSUE_INTAKE.md](ISSUE_INTAKE.md); reuse recorded intent and ask only unresolved consequential questions. Continue independent authorized work while a decision is pending.
3. Select an authorized node and an isolated branch/worktree. Check resource capacity and shared ownership before heavy work, then implement the smallest coherent outcome. An unavailable heavy runtime does not prevent source changes, small tests or other useful implementation that fits.
4. Verify affected behavior using the evidence rules below. Load cumulative product changes into local Docker during a safe owned window and identify commits/PRs. Record a pending local review step when blocked; do not claim hosted checks establish local delivery. Documentation-only work uses static checks without a runtime reload.
5. Open one PR per coherent batch under the default policy unless the task restricts publication. Continue eligible work while review is pending. Required exact-head CI and applicable independent review remain; merge only under AGENTS.md's individual approval or explicit task-specific authority. Neither deployment nor user acceptance follows from merge.
6. Finish owned cleanup and the compact checkpoint. After an authorized merge, reconcile affected issues/parents and close only completed scope or a visible transfer with criteria, preserving evidence/history. Update Foundry only when durable knowledge changes.

Keep useful bug reports with reproduction/uncertainty, impact and resolving PRs after duplicate checks. A failed harness attempt or missing evidence usually stays with the existing batch; separate issues are for independently actionable work. Bounded audits remain appropriate when requested, for concrete risk or when no eligible agreed work remains. Record the question, next test and stopping criterion; use results to fix user workflows instead of expanding qualification indefinitely.

## Proportionate verification and evidence reuse

Choose checks from the changed behavior and risk. Focused regression tests come first; shared behavior, schema, security, data-integrity, concurrent writers and unexplained failures warrant broader coverage. Do not weaken required CI or applicable ownership, quantity/reservation conservation, privacy, rollback/replay and concurrency protections to fit a machine. Run those checks in an authorized environment capable of them or leave their status pending.

Record the revision, commands/results, relevant environment/fixture binding and limitations for checks actually run. Reuse a passing result only while its tested inputs and assumptions still apply. Explain which later change invalidates which evidence; rerun that portion. Required current-head CI must still pass on the actual head. Independent reviewers inspect source and applicable evidence and add checks where needed, rather than automatically duplicating successful costly author runs. A green test suite establishes covered behavior, not absence of every bug; a non-reproducing rerun does not explain a prior failure.

For product changes, inspect affected browser workflows in the review runtime, including relevant desktop/phone layouts. Broad local `verify` includes a build and browser suite; use it when justified rather than as an aggregate prerequisite for every docs edit. Source/runtime identity and known harness adaptations must support the claim being made; do not add unrelated certification gates to a narrow fix.

## Resource assignment and shared ownership

Brian clarified on October 22, 2026 that the laptop must continue complete implementation and local validation, including production builds, database/browser tests and Docker/app reloads. This supersedes the earlier blanket laptop heavy-work pause and source-only scheduled-worker restriction. It does not grant merge, production deployment or physical scanner authority. Existing issue ownership and the laptop/desktop product-area split remain.

Use one acquisition-worker replica for normal laptop operation. Inspect service identity and actual process concurrency; preserve separate required catalog/OCR/visual/printing functions. Additional qualification processing pipelines should run only during an owned test window, then drain and stop when no longer needed. Do not cancel queued work or infer that a retained review database is disposable.

Before a build, full suite, fixture window or reload, claim the shared laptop runtime, inspect active workloads, and record a conservative task-specific memory/storage budget including operating headroom. `scripts/laptop-runtime-guard.ps1` provides local atomic admission and exact-owner release; pass the actual repository root, run/thread, operation, budgets and verified local database container ID. Host-only work can use `-HostOnly` with no Docker budget or container, so a stopped Docker database does not block a host build. All participating worktrees use the root's same `.local-data/issue-worker/run.lock.json`. This is local coordination, not distributed fencing or continuous resource enforcement. Inspect uncoordinated workloads separately. If an operation does not fit, arrange an owned smaller/serial check or retire verified unused resources; do not reinstate a blanket development hold.

Build only when changed inputs or a concrete validation gap require it. Reuse applicable passing evidence and the current review runtime. At handoff record host and Docker free space and material image/cache/scratch growth. Retire only verified owned superseded resources after preserving compact evidence; protect active review, rollback and unique data. Never use blanket pruning or application-volume deletion to make room. Local operation does not need production's redundant replicas, continuous production builds or all retained qualification stacks running at once.

Budget memory where the operation runs: host-only work uses Windows available memory; Docker work uses the VM's available memory plus a separately specified positive Windows reserve (`-HostMemoryReserveMiB`). Do not require an entire Docker build's working set to fit again in Windows free memory when the VM already holds usable memory. Inspect the actual target container/build limits separately; the probe container identifies the local VM, not every target's cgroup allowance. Budgets and reserves are task-specific, and capacity samples are not continuous enforcement.

Before heavy execution, inspect current available memory, host/Docker disk, active jobs/processes and the proposed task's measured or conservative CPU/memory/storage envelope. Distinguish distinct pipeline roles from replicas. Match the task to an authorized node with the required tools/data and headroom; serialize heavy shared use. Choose a smaller implementation/check or an already authorized isolated environment when it does not fit. Do not prescribe fixed universal thresholds, make the laptop review-only, remove a stage, cancel queued jobs or raise shared limits as a shortcut.

Record one owner for each batch and shared-runtime mutation, including node/resource and run/thread identity. Check actual state and claims before starting; isolated worktrees do not isolate shared Docker/databases or the common Git directory. A filesystem lock covers its named host/path, not other nodes. GitHub labels, scheduling offsets and read-before-write checks do not create a distributed lock. Defer a conflicting write and continue independent work; do not silently overwrite another owner's changes.

For handoff or interrupted ownership:

1. Reconcile the exact recorded lock identity with the owner, child processes/jobs, target runtime and checkpoint. An old timestamp or idle chat alone does not establish that work ended. If execution outcome or ownership is uncertain, leave the resource untouched and investigate read-only or use independent work.
2. A live owner drains/completes its bounded work, cleans owned temporary resources and releases through the supported exact-owner path after children are terminal. Record a continuing decision/pause separately with its target and next action. Releasing a lock does not lift an explicit heavy-work pause.
3. Recovery of a terminal/unavailable owner requires a designated authorized coordinator, verified absence of its live work, a record of the previous identity and an operation bound to that exact expected identity. Re-read before recovery; changed identity invalidates the attempt. Use supported handoff/recovery tooling. If tooling cannot enforce the expected owner or terminal state cannot be verified, report the specific gap and prepare a concrete recovery proposal separately; do not blindly unlink a lock, impersonate its owner or install automatic expiry.

These are operating requirements, not a claim that recovery, resource admission or distributed fencing is implemented. Existing local helpers support only their actual operations. This documentation pass does not recover any current lock or authorize runtime/schedule/topology changes.

## Lean handoff and checkpoints

At future handoffs, within existing authority, retire the batch's owned temporary processes, fixture containers/networks and disposable workspaces after confirming terminal state and cleanup. First identify active references, other owners, current review candidates, required rollback/recovery and unique source/failure evidence. Keep those protected resources. Preserve compact logs, commands, results and identity manifests before retiring reproducible superseded images, caches and scratch copies; an authoritative failure record need not retain every heavyweight failed image. Local retention can be shorter than production retention.

This is not a blanket Docker prune, volume/application-data deletion, retention-setting change or retroactive cleanup order. Uncertain uniqueness, active use or recovery need blocks removal of that item, not all independent cleanup. Record retained items and their concrete reason/next step; do not keep an idle runtime lock as a retention marker.

Keep a small **Current work** section in [WORK_CHECKPOINT.md](WORK_CHECKPOINT.md), scoped to the owning batch/node:

- Branch/head, issue/PR links and current request/authority reference.
- Scope and latest completed operation; owned live resources/lock identity or verified absence.
- Completed and pending checks with evidence links and relevant limits.
- Blocked decision (if any), cleanup/retained-resource status and next safe step.

Replace only the owner's current section after reconciling concurrent edits. Keep unique decisions, failures and historical context once under dated history or linked existing records. Do not append full unchanged heartbeat snapshots, require a new artifact for every step, or bulk archive another worker's checkpoint WIP. History describes its observation time; it never proves current ownership, authorization or successful completion. After interruption, reconcile git, GitHub and actual processes/runtime before retrying an uncertain operation. A checkpoint is not a scheduler or automatic restart mechanism.

## Project organization and wiki

Keep related desktop chats and scheduled work in the MTG Archives local project with this repository as primary folder; verify assignment through supported UI controls, not internal app-storage edits. Public submissions remain simple; maintainers own enrichment and conservative origin handling under ISSUE_INTAKE.md. Existing schedule owners manage their own configuration; do not create duplicates. Unattended laptop work needs it awake, powered on, online and the app running. Inspect actual configuration/executions before claiming a schedule active; old setup notes do not establish current state.

Foundry holds durable decisions, workflows, operational knowledge and milestones; GitHub owns live development status. Keep transient commands/evidence in the repository and PRs, link delivered work and never put secrets in Foundry. Update relevant durable knowledge when it changes rather than duplicating unchanged status after every run.

## Product priorities

- Approximately 150,000 physical copies in the largest collection, with fewer unique printings and inventory records.
- Hundreds of parent locations and thousands of sub-locations.
- Around four regular users, with strongly uneven collection sizes.
- Desktop first; important workflows must remain usable on phones.
- Inventory selection/moves and physical storage occupancy remain supported workflows; current task priorities come from the user and live GitHub queue.
- Future roadmap: connecting independently hosted installations to browse public decks and cards.
- Future design discussion: visual representations of cards, boxes, and sections.

## Historical setup and pilot context

The remaining dated setup/pilot records preserve their original scope, failures and observations. They are not a current queue, schedule/capability assessment or authorization. In particular, old permissions, unconfigured-scheduler statements, test counts and pending PRs must be reconciled with live state rather than rerun as setup tasks.

### First batch: vault sections and inventory moves

Vaults are existing parent locations with sections currently created on demand. Inspect the data before deciding how to recognize or upgrade existing vaults; preserve current placements and quantities.

Acceptance criteria:

1. Creating a vault automatically provides six sections numbered 0 through 5. Ordinary storage retains flexible sections.
2. Each vault section has an advisory capacity of 85 physical cards. Exceeding it warns that cards may not fit, but does not prohibit the operation.
3. Show physical-card count and remaining space for every section, including empty, full, partially filled, and over-capacity states. For example, a section containing 68 cards has 17 spaces left.
4. Make single and multiple card selection and movement straightforward, preserving relevant browsing context.
5. Support selecting existing inventory and filling sections in batches of about 85 cards.
6. Support checking remaining space before scanning/importing new cards and assigning that batch to a section.
7. Count copies rather than distinct printings or row count. Avoid counting a move within the same section as new occupancy.
8. Preserve ownership, printing/finish/condition/language, applicable reservations, quantity conservation, and inventory audit history. Test stale selections and concurrent mutations as appropriate.
9. Verify desktop and phone layouts, advisory over-capacity behavior, selection/move workflows, and refreshed counts in the Docker build.
10. Open the batch PR with validation evidence and leave it unmerged pending individual approval.

### Setup checkpoint: 2026-09-19

- Working branch: workflow/autonomy-setup. No implementation changes to the vault feature have been made yet.
- Installed Windows desktop package: OpenAI.Codex, version 26.908.9136.0. Windows lists its launcher as ChatGPT. The app was launched, and the user confirmed being signed in and creating the MTG Archives local project with this repository as its primary folder.
- Node, Codex CLI, GitHub CLI, and Docker are installed. GitHub CLI authentication was verified during setup.
- The existing Chrome browser integration connected successfully. Desktop-wide Computer Use is not yet verified or configured.
- Normal shell commands and the built-in patch tool intermittently fail with a Windows sandbox setup-refresh error. Explicitly approved commands can run. The user requested Full access, but the active session has not yet been confirmed to use it.
- Docker reports the web container healthy, but both Chrome and a host curl request to http://127.0.0.1:13001 returned an empty response. Diagnose before relying on UI verification; do not treat the health status alone as proof that the host can use the app.
- Existing verify command covers Prisma generation, typecheck, automated tests, production build, and Playwright. No full suite has been run as part of this setup.
- Browser tests currently target port 13001 and retain failure traces, screenshots, and video. Current user authorization allows tests to manipulate that local data.
- The checked-in GitHub workflow publishes Docker images; a separate CI test workflow still needs design and implementation.
- Recurring audit cadence, run limits, overlap prevention, resumable queue tracking, feature coverage checklist, and automated build evidence remain to be implemented. Do not claim unattended monitoring is active yet.
- Foundry now records the durable workflow policy, wiki organization, scale targets, and approved inventory-organization requirements. Implementation status remains in GitHub and this setup checkpoint.
- Direct read/write access to the relevant Obsidian Markdown notes was verified. Attaching the Foundry MTG Archives notes directory as a secondary desktop-project folder is recommended for reliable discovery. Full access and general desktop-app control still need verification in the desktop session.

### Pilot checkpoint: 2026-09-19

- The session now uses Full access with routine command approvals disabled. Direct repository and Foundry access works. The desktop helper responded during setup, but project placement remains user-confirmed rather than independently controlled in the ChatGPT UI.
- The initial empty-response problem recovered after a web-container restart and startup completion. Validate HTTP from Windows after every deployment, even when the container health check passes.
- Baseline: Prisma generation, typecheck and 501 automated tests passed. Eight browser workers overloaded the shared local baseline; a serial run isolated four outdated UI expectations. Tests now use one worker and updated expectations for the current app.
- The vault pilot is implemented on `feature/vault-inventory-pilot` in PR #217. See `docs/VAULT_PILOT.md` for scope and limits, and `docs/LOCAL_REVIEW_BUILD.md` for the tested commit/image and final passing verification (504 automated tests; 25 browser passes and 2 explicit skips).
- Recurring work is still not configured or active. Continue to require individual approval for every merge.

### Historical resumption instruction

The original instruction below is preserved as history. Resume using the current execution loop and active permission environment; do not request Full access merely to match an old observation. AGENTS.md governs current authority and task-specific exceptions.

> Open this repository as a local project, use the Windows-native environment and PowerShell, and select the requested Full access permissions. Resume the existing conversation if it is available; otherwise read AGENTS.md, CODEX.md, WORK_CHECKPOINT.md, this file, and the Foundry project hub before continuing. Check GitHub before treating historical setup checkpoints as current tasks. Verify command execution, editing, browser interaction, and Docker access, then resume the next safe step. No PR may merge without explicit approval for that individual PR.
