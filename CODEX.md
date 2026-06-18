# Codex local workflow

This project is MTG-Archives, a Next.js + Prisma app running locally with Docker Desktop on Windows.

Local development branch workflow:
- Work on a feature branch, not directly on main.
- Build and test local changes against this local checkout.
- Push the feature branch to GitHub and open a PR back into main.

Docker commands:
- Start or rebuild the app:
  docker compose up -d --build

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

Important safety rules:
- Do not run docker compose down -v unless explicitly asked.
- Do not delete Docker volumes.
- Do not wipe or reset the database unless explicitly asked.
- Do not remove containers unless explicitly asked.
- Prefer docker compose up -d --build after app changes.
- After making changes, check Docker logs and test the page.
- If Docker access is blocked by Codex sandbox permissions, request approval for the Docker command.
- Keep docker-entrypoint.sh with LF line endings. Do not convert shell scripts to CRLF.
