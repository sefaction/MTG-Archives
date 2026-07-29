# Deployment foundation

MTG Archives uses layered Compose files so local development, production image
pulls, and Unraid/Portainer deployments share the same service names and
environment contract.

## Compose files

- `docker-compose.yml` is the common stack definition, including the web app,
  app database, pricing database, Redis, and pricing worker services.
- `docker-compose.local.yml` is the local development layer. It builds from the
  local checkout and stores data under `.local-data/`.
- `docker-compose.prod.yml` switches deployable services to GHCR images and
  `pull_policy: always`.
- `docker-compose.unraid.yml` keeps persistent bind mounts explicit for
  `/mnt/user/appdata/...` style deployments.

## Local development

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

The local app is available at:

```text
http://127.0.0.1:13001
```

Do not run `docker compose down -v` for normal development.

## Production image deployment

GitHub Actions publishes the web image to:

```text
ghcr.io/sefaction/mtg-archives-web
```

The `main` branch publishes:

```text
ghcr.io/sefaction/mtg-archives-web:main
```

Platform branches publish sanitized branch tags such as:

```text
ghcr.io/sefaction/mtg-archives-web:platform-pricing-worker-stack
```

Pull and start the production image stack:

```bash
IMAGE_TAG=main docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
IMAGE_TAG=main docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Unraid / Portainer

For Unraid or Portainer stacks, use the common, production, and Unraid files
together:

```bash
IMAGE_TAG=main docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.unraid.yml pull
IMAGE_TAG=main docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.unraid.yml up -d
```

Use the platform branch image while testing the refactor:

```bash
IMAGE_TAG=platform-pricing-worker-stack docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.unraid.yml pull
IMAGE_TAG=platform-pricing-worker-stack docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.unraid.yml up -d
```

If your Unraid Compose Manager project only supports one compose file, use the
standalone flattened file instead:

```bash
IMAGE_TAG=main docker compose -f docker-compose.unraid.flat.yml pull
IMAGE_TAG=main docker compose -f docker-compose.unraid.flat.yml up -d
```

Do not use `docker-compose.unraid.yml` by itself. It is only an override layer
and does not contain image definitions for every service.

Keep persistent host paths in `.env` as complete paths. Avoid nested expansion
for Unraid/Portainer reliability:

```env
POSTGRES_DATA_PATH=/mnt/user/appdata/mtg-archive/postgres
PRICING_POSTGRES_DATA_PATH=/mnt/user/appdata/mtg-archive/pricing-postgres
REDIS_DATA_PATH=/mnt/user/appdata/mtg-archive/redis
UPLOADS_DATA_PATH=/mnt/user/appdata/mtg-archive/uploads
IMPORTS_DATA_PATH=/mnt/user/appdata/mtg-archive/imports
EXPORTS_DATA_PATH=/mnt/user/appdata/mtg-archive/exports
BACKUPS_DATA_PATH=/mnt/user/appdata/mtg-archive/backups
SCRYFALL_DATA_PATH=/mnt/user/appdata/mtg-archive/scryfall
```

## Adding future services

Future workers should follow the same contract:

1. Add the service to `docker-compose.yml`.
2. Add image/pull overrides to `docker-compose.prod.yml`.
3. Add persistent Unraid mounts to `docker-compose.unraid.yml` only when the
   service owns durable files.
4. Add a GHCR image target in `.github/workflows/docker-publish.yml`.
5. Keep page-load paths in the web app independent from worker availability.

This phase includes the first pricing worker stack:

- `pricing-postgres` stores pricing history, worker runs, logs, and future job
  records outside the main app database.
- `redis` is reserved for future queue/cache work and is not on the web page
  load path.
- `pricing-worker` starts with `npm run worker:prices`, initializes the pricing
  database schema, and writes heartbeat/run/log records. Actual MTGJSON import
  processing is intentionally left for a later phase.

The application also includes a lightweight `notification-worker`:

- it uses the main `DATABASE_URL` because wishlist activity and local
  notifications are authoritative application state;
- it checks for completed hourly wishlist windows with
  `npm run worker:notifications`;
- it also claims database-backed outbound delivery jobs with expiring leases
  and preserves each success or failure attempt;
- `NOTIFICATION_WORKER_INTERVAL_MS` controls the check interval, not hourly
  digest grouping, while `NOTIFICATION_DELIVERY_*` settings control batch size,
  lease duration, attempt limits, and bounded exponential retry timing;
- delivery queue health and failure history are available to administrators at
  `/admin/notifications`;
- the web application and immediate trade-event notifications continue to work
  when this worker is unavailable.

Signed webhook delivery does not require a manually configured key. On first
startup, the web container generates a 32-byte master key at
`$BACKUP_DIR/.system-secrets/notification-webhook.key`. Both the web and
notification-worker services mount the same `BACKUPS_DATA_PATH`, so the worker
can decrypt saved destinations after container recreation.

The generated key is intentionally outside PostgreSQL and is not packaged into
downloadable `mtg-archives-backup-*.tar.gz` archives. Include the hidden
`BACKUPS_DATA_PATH/.system-secrets` directory in the server's protected appdata
backup or copy it separately when moving the deployment. Restoring the database
without this file requires recreating saved webhook destinations.

Webhook destinations are managed at `/settings/webhooks`. Public destinations
must use HTTPS. An administrator may explicitly approve an HTTP or HTTPS
private/LAN destination, but loopback, link-local, metadata, multicast, unsafe
redirect, oversized-response, and timeout protections remain active.
