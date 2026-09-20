# Codex local workflow

This project is MTG-Archives, a Next.js + Prisma app running locally with Docker Desktop on Windows.

Local development branch workflow:

- Work on a feature branch, not directly on main.
- Build and test local changes against this local checkout.
- Push feature branches and open one PR per coherent batch without waiting for user approval. Document dependencies between PRs.
- Load completed batches cumulatively into local Docker and record the commits and unmerged PRs included in the review build.
- Continue authorized work while PRs await review. Merge each PR into main only after the user explicitly approves that individual PR.

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
- npm.cmd run verify

Standard Codex UI workflow:

1. Make the smallest useful code change on the feature branch.
2. If the running Docker app needs the new code, rebuild it with:
   docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
3. Run the full local verification command:
   npm.cmd run verify
4. For UI failures, inspect Playwright artifacts:
   - test-results/playwright
   - playwright-report
     Then rerun either:
     npm.cmd run ui:test
     or, when visual debugging is useful:
     npm.cmd run ui:test:headed
5. Check the Docker app directly when needed:
   curl.exe http://127.0.0.1:13001
   docker compose logs --tail=150 web
6. Push the feature branch and open its PR without waiting for approval; continue authorized work while keeping the combined Docker build available for review.
7. Wait for explicit user approval of each individual PR before merging it into main.

Playwright:

- Config: playwright.config.ts
- Base URL: http://127.0.0.1:13001
- Browser smoke tests live under tests/ui.
- Traces, screenshots, and videos are retained for failed UI tests.
- The backup page has GUI upload/restore controls; UI tests may verify that
  they render, but must not click destructive restore unless the exact target
  has been explicitly approved.

Important safety rules:

- The user has explicitly authorized all changes to the LOCAL MTG Archives stack and its snapshot data, including local reset/restore testing and container changes. This standing authorization satisfies the local approval conditions below; verify exact targets and keep operations scoped to this project. Production and unrelated laptop data are outside this authorization.

- Do not run docker compose down -v unless explicitly asked.
- Do not delete Docker volumes.
- Do not wipe or reset the database unless explicitly asked.
- Do not run destructive restore tests unless the exact target has been explicitly approved.
- Do not remove containers unless explicitly asked.
- Prefer docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build after app changes.
- After making changes, check Docker logs and test the page.
- If Docker access is blocked by Codex sandbox permissions, request approval for the Docker command.
- Keep docker-entrypoint.sh with LF line endings. Do not convert shell scripts to CRLF.
