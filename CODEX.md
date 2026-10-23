# Codex local workflow

This project is MTG-Archives, a Next.js + Prisma app running locally with Docker Desktop on Windows. This file is a command reference; [AGENTS.md](AGENTS.md) owns authority, queue, verification and resource policy. See [the autonomous workflow](docs/AUTONOMOUS_WORKFLOW.md) for current execution and handoff guidance.

Commands below are examples, not instructions to rebuild every change. Verify the target project, actual installed Compose overlay chain and runtime owner before mutations. The base/local pair alone may not describe the installed review stack.

Docker commands:

- Start or rebuild the app:
  docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build

- Check running services:
  docker compose ps

- View web logs:
  docker compose logs --tail=150 web

- View all logs:
  docker compose logs --tail=150

- Test app homepage:
  curl.exe http://127.0.0.1:13001

Local app URL:

- http://127.0.0.1:13001

Local admin login:

- Username: admin
- Password: admin123

Test commands:

- npm.cmd test
- npm.cmd run typecheck
- npm.cmd run build
- npm.cmd run ui:test
- npm.cmd run verify:core
- npm.cmd run verify

Standard Codex UI workflow:

1. Make a coherent change on an isolated feature branch. Reconcile the current request, existing work and relevant failure evidence.
2. Choose checks for the changed behavior under AGENTS.md. Preserve required exact-head CI and applicable security, data-integrity and concurrency checks. `verify:core` runs generation, typecheck, unit tests and a production build; `verify` also runs the browser suite. Neither is a mandatory local rerun for every documentation or narrowly scoped change.
3. Reuse applicable successful evidence and rerun what the change invalidates. For UI failures, inspect Playwright artifacts:
   - test-results/playwright
   - playwright-report
     Rerun the affected spec/case first; broaden when a shared regression or unresolved failure warrants it. Use `npm.cmd run ui:test:headed` when visual debugging helps.
4. For product changes, arrange the owned, resource-checked local review window and load the cumulative candidate using its actual overlays. Documentation-only changes need static checks, not a Docker rebuild. Record any pending runtime review step and continue work that fits the available node.
5. Check affected workflows in the Docker app when relevant:
   curl.exe http://127.0.0.1:13001
   docker compose logs --tail=150 web
6. Record included commits/PRs, tests, evidence limits and review instructions. Follow AGENTS.md's default PR delivery/individual approval policy and any narrower or later explicit task-specific authority; a local-only request does not authorize publication.
7. Complete the owned cleanup and compact handoff in the autonomous workflow. Keep current review/rollback and unique evidence; retaining a failure record does not require keeping every superseded image or cache.

Playwright:

- Config: playwright.config.ts
- Base URL: http://127.0.0.1:13001
- Browser smoke tests live under tests/ui.
- Traces, screenshots, and videos are retained for failed UI tests.
- The backup page has GUI upload/restore controls. Reset/restore tests use AGENTS.md's standing local snapshot authorization after exact-target and active-owner checks; ordinary presentation checks do not need to invoke a restore.

Important safety rules:

- Verify exact project/database/volume targets and preserve other owners' work, unique source data and required recovery before local mutations. No blanket `down -v`, volume deletion or Docker prune is implied by routine rebuilds or handoff cleanup. Follow AGENTS.md and the current task's restrictions; production and unrelated data require separate authority.
- After a runtime change, inspect relevant logs and affected workflows; container health alone does not establish host/browser usability.
- Respect the active sandbox and approval requirements. Historical Full access observations do not change the current execution environment.
- Keep docker-entrypoint.sh with LF line endings. Do not convert shell scripts to CRLF.
