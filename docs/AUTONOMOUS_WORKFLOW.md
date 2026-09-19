# Autonomous development workflow

## Agreed operating policy

The user supplies project outlines or queues. Implement coherent batches, test them, build and review them in local Docker, and open one GitHub pull request per batch automatically. Continue authorized work while reviews are pending. Every individual PR requires explicit user approval before merging into main. Never enable automatic merging or push directly to main under this authorization.

All LOCAL MTG Archives components and data are available for modification and testing. The user supplied a snapshot of the real database with multiple users. Local test operations do not require repeated confirmation; verify the exact project and database targets. This does not authorize changes to unrelated laptop resources or production infrastructure.

Work runs only while this laptop is powered on, awake, and online. Keep persistent checkpoints and reconcile interrupted commands before resuming. Scheduling is not yet configured or verified.

Catalogue discovered bugs as GitHub issues, avoid duplicates, record reproduction and impact, and link the PRs that resolve them. Close issues after merge. When the assigned queue is empty, audit workflows, regressions, and feature parity; improve UI/UX at scale and suggest larger additions. A green test suite establishes the tested behavior, not the absence of every possible bug.

GitHub issues and PRs remain authoritative for live development status. Foundry stores durable decisions and operational knowledge. Local builds should identify the included commits and unmerged PRs so cumulative review is reproducible.

## Project organization and wiki

Keep all related desktop chats and scheduled work in the MTG Archives local project, attached to this repository as its primary folder. Use focused chat titles, such as Workflow setup, Vault sections and moves, and Regression audit. Existing chats should be placed under the project through supported UI controls where available; do not modify the app's internal storage to reorganize them. Keep ordinary unrelated chats separate. Project assignment is a UI setup step, not something guaranteed by this document.

The existing Foundry project hub is the wiki entry point. Read it and the relevant linked workflow, architecture, operations, roadmap, and feature notes before each batch. Update durable decisions, user workflows, acceptance criteria, operational procedures, and milestones when work changes them. Maintain links between notes and cite the relevant GitHub issues and PRs. Keep transient commands, test artifacts, and code-specific details in the repository and PRs; never copy secrets into notes. Live GitHub status takes precedence over historical notes.

## Product priorities

- Approximately 150,000 physical copies in the largest collection, with fewer unique printings and inventory records.
- Hundreds of parent locations and thousands of sub-locations.
- Around four regular users, with strongly uneven collection sizes.
- Desktop first; important workflows must remain usable on phones.
- Primary friction: selecting and moving existing inventory quickly and understanding physical storage occupancy.
- Future roadmap: connecting independently hosted installations to browse public decks and cards.
- Future design discussion: visual representations of cards, boxes, and sections.

## First batch: vault sections and inventory moves

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

## Setup checkpoint: 2026-09-19

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

## Pilot checkpoint: 2026-09-19

- The session now uses Full access with routine command approvals disabled. Direct repository and Foundry access works. The desktop helper responded during setup, but project placement remains user-confirmed rather than independently controlled in the ChatGPT UI.
- The initial empty-response problem recovered after a web-container restart and startup completion. Validate HTTP from Windows after every deployment, even when the container health check passes.
- Baseline: Prisma generation, typecheck and 501 automated tests passed. Eight browser workers overloaded the shared local baseline; a serial run isolated four outdated UI expectations. Tests now use one worker and updated expectations for the current app.
- The vault pilot is implemented on `feature/vault-inventory-pilot` in PR #217. See `docs/VAULT_PILOT.md` for scope and limits, and `docs/LOCAL_REVIEW_BUILD.md` for the tested commit/image and final passing verification (504 automated tests; 25 browser passes and 2 explicit skips).
- Recurring work is still not configured or active. Continue to require individual approval for every merge.

## Continuing work

Open this repository as a local project, use the Windows-native environment and PowerShell, and select the requested Full access permissions. Resume the existing conversation if it is available; otherwise read AGENTS.md, CODEX.md, this file, and the Foundry project hub before continuing. Verify command execution, editing, browser interaction, and Docker access. Finish setup, diagnose host access to the app, then implement the vault batch and open a PR. No PR may merge without explicit approval for that individual PR.
