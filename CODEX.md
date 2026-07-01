# Codex local workflow

This project is MTG-Archives, a Next.js + Prisma app running locally with Docker Desktop on Windows.

Local development branch workflow:

- Work on a feature branch, not directly on main.
- Build and test local changes against this local checkout.
- Push the feature branch to GitHub and open a PR back into main.

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
6. Push the feature branch and open a PR into main for approval.

Playwright:

- Config: playwright.config.ts
- Base URL: http://127.0.0.1:13001
- Browser smoke tests live under tests/ui.
- Traces, screenshots, and videos are retained for failed UI tests.
- The backup page has GUI upload/restore controls; UI tests may verify that
  they render, but must not click destructive restore unless the exact target
  has been explicitly approved.

Important safety rules:

- Do not run docker compose down -v unless explicitly asked.
- Do not delete Docker volumes.
- Do not wipe or reset the database unless explicitly asked.
- Do not run destructive restore tests unless the exact target has been explicitly approved.
- Do not remove containers unless explicitly asked.
- Prefer docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build after app changes.
- After making changes, check Docker logs and test the page.
- If Docker access is blocked by Codex sandbox permissions, request approval for the Docker command.
- Keep docker-entrypoint.sh with LF line endings. Do not convert shell scripts to CRLF.
