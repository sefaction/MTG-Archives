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
- The user authorizes changes to all local MTG Archives code, Docker components, data, and databases, including reset and restore testing. The local database is a snapshot suitable for testing. This authority does not extend to unrelated projects or production infrastructure.
- Catalogue discovered bugs as GitHub issues, check for duplicates, prioritize fixes sensibly, and link resolving pull requests. Close resolved issues after their fixes merge.
- After assigned tasks, audit workflows and feature parity, improve UI/UX at scale, and suggest larger product additions. Preserve intentional role, ownership, and public/private differences.
- Design for roughly 150,000 physical card copies, fewer unique printings, hundreds of locations, thousands of sub-locations, and four regular users with uneven collection sizes.
- Desktop usability has priority; key workflows also need to work on phones.
- Track future connections between separate installations for public cards and decks, and visual representations of cards and storage, as roadmap directions.
- See `docs/AUTONOMOUS_WORKFLOW.md` for setup progress and the first inventory batch requirements.

## GitHub authentication

- Use the normal GitHub CLI browser flow: `gh auth login -h github.com -p https -w`.
- Complete the authorization in the browser, then verify it with `gh auth status` before pushing.
- The CLI process may remain open after the browser authorization succeeds; trust the follow-up status check rather than recording or handling tokens directly.
