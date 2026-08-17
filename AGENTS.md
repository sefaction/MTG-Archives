# MTG Archives Project Instructions

## Foundry knowledge workflow

At the beginning of work in this repository:

- Read the Foundry project hub at `C:\Users\brian\Projects\Foundry-AI\20 - Projects\Personal\MTG Archives\MTG Archives.md`.
- Follow links from the hub to lifecycle, architecture, operations, and roadmap notes when they are relevant to the work.
- Treat GitHub issues and pull requests as the authority for live development status.
- Update Foundry only when work creates durable knowledge, such as a decision, milestone, operational change, or roadmap change.
- Keep temporary implementation details and code-specific instructions in the MTG Archives repository and its GitHub issues or pull requests.
- Never copy credentials, secrets, tokens, or other sensitive values into Foundry.

If the Foundry hub is unavailable, continue with repository and GitHub context and report that the project notes could not be accessed.

## Change delivery workflow

When the user suggests a change:

1. Ask a few brief clarifying questions when they are needed to make the request clear.
2. Once the request is clear, implement the change and load it into the local Docker environment for review.
3. Wait for the user to review the work and either approve it or request further changes.
4. If changes are requested, revise the implementation and return it to the local Docker environment for another review.
5. After the user explicitly approves the work, push it to a pull request and merge the pull request into `main`.
6. Close any related open issues with notes linking to the pull request that resolved them.

## GitHub authentication

- Use the normal GitHub CLI browser flow: `gh auth login -h github.com -p https -w`.
- Complete the authorization in the browser, then verify it with `gh auth status` before pushing.
- The CLI process may remain open after the browser authorization succeeds; trust the follow-up status check rather than recording or handling tokens directly.
