# MTG Archives Project Instructions

## Foundry knowledge workflow

At the beginning of work in this repository:

- Read the Foundry project hub at `C:\Users\brian\Projects\Foundry-AI\20 - Projects\Personal\MTG Archives\MTG Archives.md`.
- Follow links from the hub to lifecycle, architecture, operations, and roadmap notes when they are relevant to the work.
- Use the linked Foundry notes as the project wiki and as inputs to workflow planning. Consult the autonomous development workflow and relevant feature notes before each batch; reconcile historical notes with live GitHub status.
- Treat GitHub issues and pull requests as the authority for live development status.
- Update Foundry only when work creates durable knowledge, such as a decision, milestone, operational change, or roadmap change.
- Keep temporary implementation details and code-specific instructions in the MTG Archives repository and its GitHub issues or pull requests.
- Never copy credentials, secrets, tokens, or other sensitive values into Foundry.

If the Foundry hub is unavailable, continue with repository and GitHub context and report that the project notes could not be accessed.

## Change delivery workflow

When the user suggests a change:

1. Ask a few brief clarifying questions when they are needed to make the request clear.
2. Once the request is clear, implement the change and load it into the local Docker environment for review.
3. Push a branch and open one pull request per coherent batch without waiting for user approval. Continue authorized work while pull requests await review. Load batches cumulatively into local Docker and record the included commits and pull requests.
4. If changes are requested, revise the implementation and return it to the local Docker environment for another review.
5. Merge each pull request into `main` only after the user explicitly approves that individual pull request. Approval of another pull request, opening a pull request, or local testing is not merge approval.
6. Close any related open issues with notes linking to the pull request that resolved them.

## Autonomous local work

- Keep related desktop chats and scheduled work under the MTG Archives local project, with this repository as its primary folder. Use focused titles for setup, feature batches, bugs, and audits; do not create unrelated standalone chats for this work. Project assignment must be verified in the desktop UI, not assumed from a file change.
- Run unattended work only while this laptop is powered on, awake, and connected to the internet. Save progress for recovery after interruptions; scheduling must be configured and verified before claiming it is active.
- Ask focused clarification questions when a consequential choice needs user input. Record unanswered questions and continue independent, authorized tasks from the repository/GitHub queue; do not guess the blocked decision or merge PRs.
- Maintain a resumable checkpoint in `docs/WORK_CHECKPOINT.md`: active branch, related issues/PRs, changed scope, completed and pending checks, outstanding questions, and the next safe step. Reconcile it with git, GitHub, and running processes after interruptions or context/session limits; never assume an interrupted operation completed.
- The user authorizes changes to all local MTG Archives code, Docker components, data, and databases, including reset and restore testing. The local database is a snapshot suitable for testing. This authority does not extend to unrelated projects or production infrastructure.
- Catalogue discovered bugs as GitHub issues, check for duplicates, prioritize fixes sensibly, and link resolving pull requests. Close resolved issues after their fixes merge.
- After assigned tasks, audit workflows and feature parity, improve UI/UX at scale, and suggest larger product additions. Preserve intentional role, ownership, and public/private differences.
- Design for roughly 150,000 physical card copies, fewer unique printings, hundreds of locations, thousands of sub-locations, and four regular users with uneven collection sizes.
- Desktop usability has priority; key workflows also need to work on phones.
- Track future connections between separate installations for public cards and decks, and visual representations of cards and storage, as roadmap directions.
- See `docs/AUTONOMOUS_WORKFLOW.md` for setup progress and the first inventory batch requirements.

## GitHub issue organization and upkeep

Before opening or substantially changing an issue, search open and closed issues and relevant PRs for duplicates, read the current parent scope and latest comments, and reconcile merged work with the actual remaining requirements. GitHub owns live status; preserve historical bodies, comments, failed tests and user decisions.

Use these independent label dimensions on every open issue:

- **Work type (exactly one):** `type: bug` (broken behavior), `type: feature` (new capability), `type: improvement` (better existing behavior), `type: maintenance` (upkeep), or `type: validation` (acceptance/evidence work).
- **Workflow status (exactly one):** `status: backlog` (available, unclaimed work), `status: in progress` (implementation/qualification underway, or an actively progressing tracker), `status: investigating` (cause not established), `status: awaiting review` (qualification complete and PR ready for individual review), `status: awaiting validation` (specific acceptance evidence pending), or `status: needs decision` (a consequential choice blocks the next action). A draft with unfinished local qualification is not awaiting review. These labels do not replace exact-owner locks or claim comments; preserve the existing `in-progress` claim label where used.
- **Area (one or more):** `area: recognition`, `area: scanner`, `area: review`, `area: inventory`, `area: data integrity`, `area: infrastructure`, `area: test infrastructure`. Add a similarly named area only for a distinct domain that existing areas cannot express.
- **Scope flags:** `roadmap` marks a coordinated top-level product roadmap; `tracker` marks an umbrella/phase issue linking narrower work and acceptance. The top roadmap may carry both. Neither flag means deferred, and a bug tracker remains `type: bug`.
- **Planning flag:** `deferred` marks intentionally postponed scope. Keep its type, area and workflow status; a deferred bug remains a bug. Record why it is deferred, its parent and the trigger for reconsideration. Do not defer a whole active tracker because some children are future work.

For this organized queue, `type: feature` replaces the overloaded `enhancement` label and `deferred` replaces future-only use of `roadmap`. Do not rename/delete the legacy repository labels globally or remove unrelated labels, assignees or other owners' claims. Do not require a GitHub Projects board.

Keep a concise current summary at the top of each issue: problem/intended outcome; evidence with exact revision, denominator and limitations; work already delivered with PR links; exact remaining next action; and explicit acceptance/completion criteria. Link parent, children, dependencies and resolving PRs. Broad issues must distinguish delivered, remaining and deferred scope so delivered work is not reimplemented. Mark older scope as preserved history rather than erasing it. Investigations need one bounded next test, the evidence it must capture and a stopping criterion; a non-reproducing rerun leaves the historical cause unknown.

Distinguish author-reported local qualification, independent qualification, CI success on an exact head, merge, deployment to a named installation and independent user acceptance. None implies the others. Update the current summary and status as work lands; a partial merge does not close a broad issue. Close only when its stated scope is met, or when every unresolved requirement has been visibly transferred to linked issues with acceptance criteria and a closure rationale. Link merged resolving PRs; remove open-workflow status labels on closed issues. Preserve failure records and source-data protections, and re-read changed metadata to verify application. Re-read immediately before edits and defer a conflicting concurrent change rather than overwriting it.

Current capture priority is fi-7160 only. Brian's October 13 report of about 1,000 ordinary scans accepts ordinary physical operation; do not reinstate broad hardware qualification as a standing blocker. Independent recognition accuracy, software recovery, privacy and data integrity remain separately open. Other capture methods/scanners, extended virtual-source validation, optional GPU and optional fi-7160 background/framing remain deferred. Respect declined counter rereads and specific settings/test deferrals. This process creates no additional physical-operation, merge or deployment authority; every PR still needs its own explicit user merge approval.

Issue forms and the advisory issue-event check are described in [.github/ISSUE_GUIDELINES.md](.github/ISSUE_GUIDELINES.md). The check never assigns status or rewrites issue bodies; structural success is not proof of fresh summaries or accepted work. API-created issues must follow the same policy, even when created by automation whose events do not trigger another workflow.

Every PR must identify affected issues and parent trackers and use the [PR merge checklist](.github/pull_request_template.md). After each individually approved merge, the merger re-reads affected issues and latest comments, refreshes their current summaries with merged PR/revision links and evidence limits, reconciles the exact remaining next action and acceptance criteria, preserves dated history, and reads back edits. Do not leave merged work described as awaiting review. Merge does not establish named-installation deployment or independent user acceptance; keep broad issues open for their remaining scope. Never overwrite a conflicting concurrent edit.

Useful saved issue filters:

- [Current work](https://github.com/sefaction/MTG-Archives/issues?q=is%3Aissue%20is%3Aopen%20-label%3Adeferred%20-label%3Atracker): non-deferred individual work, including investigations, decisions and review/validation waits.
- [Roadmap and acceptance](https://github.com/sefaction/MTG-Archives/issues?q=is%3Aissue%20is%3Aopen%20label%3Atracker%20-label%3Adeferred): current roadmap, phases and broad acceptance trackers; #302 is the top roadmap.
- [Future work](https://github.com/sefaction/MTG-Archives/issues?q=is%3Aissue%20is%3Aopen%20label%3Adeferred): intentionally postponed bugs, features, improvements and validation.

## GitHub authentication

- Use the normal GitHub CLI browser flow: `gh auth login -h github.com -p https -w`.
- Complete the authorization in the browser, then verify it with `gh auth status` before pushing.
- The CLI process may remain open after the browser authorization succeeds; trust the follow-up status check rather than recording or handling tokens directly.
