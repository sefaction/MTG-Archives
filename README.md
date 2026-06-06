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
3. Review the persistent storage variables. The documented default base path is `/mnt/user/appdata/mtg-archive`; each subdirectory is configured with a complete path for Portainer/Unraid reliability.
4. Start the stack:

```bash
docker compose up -d --build
```

On startup the web container runs Prisma migrations and then runs `prisma:bootstrap-admin` to ensure the configured admin account exists. `RUN_SEED_ON_START=false` by default; the application does not require demo data to start.

## Environment variables

See `.env.example` for the full list. Important settings:

- `DATABASE_URL` should use the Compose service host `postgres` inside Docker.
- `NEXT_PUBLIC_APP_NAME` controls visible branding and defaults to `MTG Inventory`.
- `APP_DATA_PATH` documents the intended base host directory for persistent application data.
- `POSTGRES_DATA_PATH`, `UPLOADS_DATA_PATH`, `IMPORTS_DATA_PATH`, `EXPORTS_DATA_PATH`, and `BACKUPS_DATA_PATH` must each point at host storage that survives container recreation.
- `COOKIE_SECURE=false` is appropriate for HTTP/LAN deployments; set it to `true` behind HTTPS.
- `RUN_SEED_ON_START=false` keeps startup free of demo data.
- `ADMIN_USERNAME` and `SEED_ADMIN_PASSWORD` control bootstrap admin creation.

## Persistent data directories

All important application data is stored outside containers through host bind mounts. `.env.example` uses complete paths instead of `${APP_DATA_PATH}/...` nested expansion because Portainer and Unraid environment handling can vary.

| Variable             | Purpose                                                       | Mounted service/path                |
| -------------------- | ------------------------------------------------------------- | ----------------------------------- |
| `POSTGRES_DATA_PATH` | PostgreSQL database files                                     | `postgres:/var/lib/postgresql/data` |
| `UPLOADS_DATA_PATH`  | Raw uploaded files, including uploaded CSV files              | `web:$UPLOADS_DATA_PATH`            |
| `IMPORTS_DATA_PATH`  | Retained import-processing files, including CSV import copies | `web:$IMPORTS_DATA_PATH`            |
| `EXPORTS_DATA_PATH`  | Generated CSV export copies                                   | `web:$EXPORTS_DATA_PATH`            |
| `BACKUPS_DATA_PATH`  | Reserved for future application-managed backups               | `web:$BACKUPS_DATA_PATH`            |

Docker will usually create missing bind-mount source directories, and the web entrypoint also runs `mkdir -p` for the application-managed directories. For the most predictable Portainer/Unraid deployment, create them before first startup:

```bash
mkdir -p /mnt/user/appdata/mtg-archive/{postgres,uploads,imports,exports,backups}
```

Permissions must allow the containers to write to their mounted directories. The PostgreSQL directory must be writable by the official Postgres container user (commonly UID/GID `999`), and the uploads/imports/exports/backups directories must be writable by the web container. The current web image runs as root, but if that changes later, update ownership accordingly. Containers can be recreated without losing database, uploaded, imported, exported, or future backup data as long as these host directories are preserved. Empty directories are valid on first startup.

## Current capabilities

- Admin-managed local users with roles and forced password-change workflow.
- Inventory browsing, filtering, sorting, page-size controls, infinite-scroll browsing mode, exact-printing and grouped-by-card views, location breakdowns, CSV export, and admin editing.
- Per-owner inventory locations such as boxes, binders, shelves, an automatic `Unassigned` default for migrated inventory, and bulk location move workflows.
- CSV inventory import preview, Scryfall matching, manual resolution, retry, and commit workflow.
- Scryfall-backed card metadata storage.
- Cache-first Scryfall lookup with durable local printing metadata and throttled live API access.
- One-for-one direct trade proposals with accept/decline/cancel, physical exchange confirmation, event history, snapshots, inventory transfer, and audit logs.

## Refactor status

This project was copied from a Sealed Commander League application. The first inventory refactor removes league navigation and demo seed data while keeping legacy database tables in place for safe migration. See `docs/INVENTORY_REFACTOR.md` for the remaining migration plan and `docs/INVENTORY_LOCATIONS.md` for the location/grouped-view design notes.

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

### Scryfall configuration

Scryfall live API calls are centralized server-side and are used only for cache misses, manual search, and explicit refresh/maintenance operations. Configure the shared client with:

```env
SCRYFALL_API_BASE_URL=https://api.scryfall.com
SCRYFALL_USER_AGENT=MTG-Archives/1.0
SCRYFALL_MIN_REQUEST_INTERVAL_MS=100
SCRYFALL_MAX_RETRIES=4
SCRYFALL_REQUEST_TIMEOUT_MS=15000
SCRYFALL_CACHE_ENABLED=true
SCRYFALL_CARD_REFRESH_DAYS=30
SCRYFALL_PRICE_REFRESH_HOURS=24
SCRYFALL_BULK_DATA_ENABLED=true
SCRYFALL_DATA_PATH=/mnt/user/appdata/mtg-archive/scryfall
SCRYFALL_CONTAINER_DATA_PATH=/app/data/scryfall
SCRYFALL_BULK_REFRESH_HOURS=24
```

`SCRYFALL_DATA_PATH` is bind-mounted into the container at `SCRYFALL_CONTAINER_DATA_PATH` for future bulk-catalog downloads. Normal inventory browsing uses card metadata already stored in PostgreSQL and does not call Scryfall.

### Import resolution jobs

Card identification runs as a durable database-backed resolution job. The user starts one job and the server crawls through unresolved import rows in safe chunks until no automatically resolvable rows remain. Tune the internal batching and polling with:

```env
IMPORT_RESOLVE_BATCH_SIZE=50
IMPORT_RESOLVE_MAX_BATCHES_PER_RUN=0
IMPORT_RESOLVE_POLL_INTERVAL_MS=1500
IMPORT_RESOLVE_STALE_JOB_TIMEOUT_MINUTES=15
```

`IMPORT_RESOLVE_MAX_BATCHES_PER_RUN=0` means a job continues through all eligible chunks. Set a nonzero value only when you intentionally want a safety stop after that many chunks.
