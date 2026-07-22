# Hjertestarterregister → OpenStreetMap

Data pipeline for the [Norwegian AED registry (Hjertestarterregisteret)](https://hjertestarterregister.113.no/)
and [OpenStreetMap](https://www.openstreetmap.org/). It keeps local, queryable
copies of both datasets in PostgreSQL as the foundation for reconciling AED
(defibrillator) locations between them.

The repo is a `pnpm` workspace + Turborepo monorepo with two long-running
services and three shared packages.

| Path                                 | Type    | Description                                                        |
| ------------------------------------ | ------- | ------------------------------------------------------------------ |
| `services/aed-registry-ingestor`     | service | Imports the AED registry into Postgres and publishes change events |
| `services/osm-ingestor`              | service | Ingests OSM AED nodes (planet + minute replication) into Postgres  |
| `packages/hjertestarterregister-sdk` | package | Typed client for the Hjertestarterregister API                     |
| `packages/osm-sdk`                   | package | Typed client for the OpenStreetMap API                             |
| `packages/typescript-config`         | package | Shared TypeScript configuration                                    |

## Prerequisites

- Node.js `26` (see `.nvmrc`) and `pnpm` `11`
- PostgreSQL and Redis — or just use Docker Compose (below)
- Hjertestarterregister API OAuth credentials (client id + secret)

## Quick start (Docker Compose)

Runs PostgreSQL (with both databases), Redis, and both services together.

```bash
# 1. Registry credentials, read by compose for the AED service
cat > .env <<'EOF'
HJERTESTARTERREGISTER_CLIENT_ID=your-client-id
HJERTESTARTERREGISTER_CLIENT_SECRET=your-client-secret
EOF

# 2. Build and start everything
docker compose up --build
```

Compose provisions a `postgres` instance with the `aed_registry_ingestor` and
`osm_ingestor` databases, a `redis` instance, and both services. Each service
runs its Drizzle migrations on startup. State persists in named volumes
(`postgres-data`, `redis-data`, `osm-planet`). Tear down with
`docker compose down` (add `-v` to also delete the volumes).

## Local development

```bash
pnpm install
```

Run a single service against your own Postgres/Redis:

```bash
cp services/aed-registry-ingestor/.env.example services/aed-registry-ingestor/.env
pnpm --filter aed-registry-ingestor start   # use `dev` for --watch
```

## Services

### aed-registry-ingestor

Long-running service that keeps a local copy of the AED registry and emits a
change event for every difference it detects.

- **Full sync** on a daily cron (`FULL_SYNC_CRON`, default `03:00` Europe/Oslo):
  fetches the whole registry, upserts it, and soft-deletes rows that are no
  longer present in the snapshot.
- **Incremental sync** every 15 minutes (`INCREMENTAL_SYNC_INTERVAL_MS`): fetches
  only changes since the stored cursor. Deletions are handled by the full sync.
- Stores the latest snapshot in the `aed` table; the cursor lives in
  `aed_registry_sync_state`.
- Publishes one BullMQ job per change to the `aed-registry-events` queue:
  `aed.created`, `aed.updated`, `aed.deleted`. Each payload carries the event id,
  type, source, timestamp, asset identity, and a serialized AED. Events are
  published only after the database transaction commits. BullMQ/Redis is used for
  the outbound queue and for the recurring sync schedulers.

Requires Postgres, Redis, and registry credentials. Env vars (see
[`.env.example`](services/aed-registry-ingestor/.env.example)):

| Variable                                | Required | Default                  |
| --------------------------------------- | -------- | ------------------------ |
| `DATABASE_URL`                          | yes      | —                        |
| `HJERTESTARTERREGISTER_CLIENT_ID`       | yes      | —                        |
| `HJERTESTARTERREGISTER_CLIENT_SECRET`   | yes      | —                        |
| `REDIS_URL`                             | no       | `redis://127.0.0.1:6379` |
| `REGISTRY_MAX_ROWS`                     | no       | `50000`                  |
| `INCREMENTAL_SYNC_INTERVAL_MS`          | no       | `900000`                 |
| `FULL_SYNC_CRON`                        | no       | `0 3 * * *`              |
| `FULL_SYNC_TIMEZONE`                    | no       | `Europe/Oslo`            |
| `HJERTESTARTERREGISTER_API_BASE_URL`    | no       | 113 production           |
| `HJERTESTARTERREGISTER_OAUTH_TOKEN_URL` | no       | 113 production           |
| `LOG_LEVEL`                             | no       | `info`                   |

Standalone container:

```bash
docker build -f services/aed-registry-ingestor/Dockerfile -t aed-registry-ingestor .
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL='postgres://user:pass@host.docker.internal:5432/aed_registry_ingestor' \
  -e REDIS_URL='redis://host.docker.internal:6379' \
  -e HJERTESTARTERREGISTER_CLIENT_ID='<client-id>' \
  -e HJERTESTARTERREGISTER_CLIENT_SECRET='<client-secret>' \
  aed-registry-ingestor
```

### osm-ingestor

Long-running service that maintains a local copy of OSM AED nodes with full
edit history.

- Checks the Geofabrik Norway planet file at startup and daily at
  `OSM_PLANET_CHECK_HOUR` (default `12:00`, Europe/Oslo). It downloads and imports
  a new build only when one is available.
- Applies OSM minute replication diffs continuously until caught up.
- **Handler-based and extensible:** each handler under `src/handlers/<name>` owns
  its tag matching and storage; register handlers in `src/handlers/index.ts`.
  Planet imports and minute syncs route every matching node to each handler. The
  `aed` handler (`emergency=defibrillator`) is enabled.
- Storage:
  - `osm_aed`: latest known state of each AED node (soft-deleted, never removed).
  - `osm_aed_history`: append-only, one immutable row per observed node version.
  - `osm_sync_state`: singleton row with planet build metadata and the minute
    replication cursor.
- Stores only — it publishes no events.

Planet downloads must live on durable storage; the container mounts `/data`. Env
vars (see [`.env.example`](services/osm-ingestor/.env.example)):

| Variable                           | Required | Default                           |
| ---------------------------------- | -------- | --------------------------------- |
| `DATABASE_URL`                     | yes      | —                                 |
| `OSM_PLANET_URL`                   | no       | Geofabrik Norway latest           |
| `OSM_PLANET_FILE_PATH`             | no       | `data/norway-latest.osm.pbf`      |
| `OSM_PLANET_RETAIN_DOWNLOADS`      | no       | `2`                               |
| `OSM_PLANET_BATCH_SIZE`            | no       | `500`                             |
| `OSM_PLANET_CHECK_HOUR`            | no       | `12`                              |
| `OSM_REPLICATION_BASE_URL`         | no       | planet.osm.org minute replication |
| `OSM_REPLICATION_POLL_INTERVAL_MS` | no       | `15000`                           |
| `OSM_RETRY_DELAY_MS`               | no       | `60000`                           |
| `OSM_USER_AGENT`                   | no       | project UA string                 |
| `LOG_LEVEL`                        | no       | `info`                            |
| `TZ`                               | no       | `Europe/Oslo`                     |

Standalone container:

```bash
docker build -f services/osm-ingestor/Dockerfile -t osm-ingestor .
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL='postgres://user:pass@host.docker.internal:5432/osm_ingestor' \
  -v osm-planet:/data \
  osm-ingestor
```

### Database migrations

Both services embed their Drizzle migrations and apply them automatically at
startup. During development:

```bash
pnpm --filter <service> db:generate   # generate a migration from schema changes
pnpm --filter <service> db:migrate    # apply migrations
pnpm --filter <service> db:studio     # open Drizzle Studio
```

## Packages

### @repo/hjertestarterregister-sdk

Typed client for the Hjertestarterregister (113) API. Handles OAuth2 token
acquisition/refresh and exposes the asset endpoints (search, get,
create/update/delete, activate/deactivate, deleted/inactive listings, and
messaging). Built on `undici` + `zod`. Consumed by `aed-registry-ingestor`.

### @repo/osm-sdk

Typed OpenStreetMap API client for reading and writing map data, including
batched changeset application. Built on `osm-api` + `zod`. Standalone, intended
for writing reconciled changes back to OSM.

### @repo/typescript-config

Shared base `tsconfig` (`base.json`) extended by every workspace package and
service — modern Node ESM settings (`NodeNext`, `ES2025`, `strict`,
`verbatimModuleSyntax`).

## Code quality

```bash
pnpm lint          # Biome lint
pnpm format        # Biome format (write)
pnpm check         # Biome lint + format (write)
pnpm check-types   # TypeScript type-check across the workspace
pnpm build         # Turborepo build
```

## Useful links

- [Hjertestarterregisteret](https://hjertestarterregister.113.no/)
- [OpenStreetMap](https://www.openstreetmap.org/)
- [Community discussion thread](https://community.openstreetmap.org/t/import-av-hjertestarterdata-fra-hjertestarterregisteret-til-openstreetmap/141501)
