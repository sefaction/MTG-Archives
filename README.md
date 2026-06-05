# MTG Inventory

Dockerized Next.js App Router application for tracking multi-user Magic: The Gathering inventories, CSV imports, Scryfall-backed card data, and direct user-to-user card trades.

## Stack

- Next.js App Router + TypeScript
- PostgreSQL + Prisma
- Tailwind CSS
- Local username/password authentication with admin-created accounts
- Scryfall card search and printing metadata
- Docker Compose / Portainer deployment support

## Fresh install

1. Copy `.env.example` to `.env`.
2. Set `SEED_ADMIN_PASSWORD` to a strong temporary password.
3. Set `POSTGRES_DATA_PATH` to persistent storage, for example `/mnt/user/appdata/mtg-inventory/postgres`.
4. Start the stack:

```bash
docker compose up -d --build
```

On startup the web container runs Prisma migrations and then runs `prisma:bootstrap-admin` to ensure the configured admin account exists. `RUN_SEED_ON_START=false` by default; the application does not require demo data to start.

## Environment variables

See `.env.example` for the full list. Important settings:

- `DATABASE_URL` should use the Compose service host `postgres` inside Docker.
- `NEXT_PUBLIC_APP_NAME` controls visible branding and defaults to `MTG Inventory`.
- `POSTGRES_DATA_PATH` should point at persistent storage.
- `COOKIE_SECURE=false` is appropriate for HTTP/LAN deployments; set it to `true` behind HTTPS.
- `RUN_SEED_ON_START=false` keeps startup free of demo data.
- `ADMIN_USERNAME` and `SEED_ADMIN_PASSWORD` control bootstrap admin creation.

## Current capabilities

- Admin-managed local users with roles and forced password-change workflow.
- Inventory browsing, filtering, sorting, image/table views, CSV export, and admin editing.
- CSV inventory import preview, Scryfall matching, manual resolution, retry, and commit workflow.
- Scryfall-backed card metadata storage.
- One-for-one direct trade proposals with accept/decline/cancel, physical exchange confirmation, event history, snapshots, inventory transfer, and audit logs.

## Refactor status

This project was copied from a Sealed Commander League application. The first inventory refactor removes league navigation and demo seed data while keeping legacy database tables in place for safe migration. See `docs/INVENTORY_REFACTOR.md` for the remaining migration plan.

## Useful commands

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:bootstrap-admin
npm run build
docker compose logs -f web
```

## Deployment notes

For Portainer/Unraid Git builds, keep `GIT_CONTEXT` pointed at this repository root and `DOCKERFILE_PATH=./Dockerfile`. If a previous iterative development migration left a failed Prisma marker, the entrypoint still attempts safe `migrate resolve` no-ops before `migrate deploy`.
