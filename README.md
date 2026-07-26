# Hjertestarterregister → OpenStreetMap

Data pipeline for the [Norwegian AED registry (Hjertestarterregisteret)](https://hjertestarterregister.113.no/)
and [OpenStreetMap](https://www.openstreetmap.org/). It keeps local, queryable
copies of both datasets in PostgreSQL as the foundation for reconciling AED
(defibrillator) locations between them.

The repo is a `pnpm` workspace + Turborepo monorepo with three long-running
services and three shared packages.

| Path                                 | Type    | Description                                                        |
| ------------------------------------ | ------- | ------------------------------------------------------------------ |
| `services/aed-registry-ingestor`     | service | Imports the AED registry into Postgres and publishes change events |
| `services/osm-ingestor`              | service | Ingests OSM AED nodes (planet + minute replication) into Postgres  |
| `services/aed-reconciler`            | service | Consumes registry events and reconciles AED edits into OSM         |
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
`osm_ingestor` databases, a `redis` instance, and all three services. Each
ingestor runs its Drizzle migrations on startup, and `aed-reconciler` starts in
dry-run mode (no OSM writes) unless you set `DRY=false`. State persists in named
volumes (`postgres-data`, `redis-data`, `osm-planet`). Tear down with
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
  longer present in the snapshot. As a circuit breaker, a full sync that would
  soft-delete `MAX_DELETIONS_PER_SYNC` AEDs or more (default 50) is aborted and
  rolled back — no rows are deleted and no events are emitted — so a bad snapshot
  cannot stream mass deletions downstream.
- **Incremental sync** every 15 minutes (`INCREMENTAL_SYNC_INTERVAL_MS`): fetches
  only changes since the stored cursor. Deletions are handled by the full sync.
- **Reconcile checkup** on a cron (`RECONCILE_CHECKUP_CRON`, default weekly,
  `04:00` Sunday Europe/Oslo): re-emits an `aed.updated` event for every active
  AED so `aed-reconciler` re-verifies each one against OSM and repairs drift a
  change-driven flow would never notice (a node deleted by someone, managed tags
  reverted, or a managed node moved). These events are enqueued at a lower BullMQ
  priority than real-time create/update/delete events, so a bulk checkup never
  delays live reconciliation. Emits no deletions, so the mass-deletion breaker is
  never involved.
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
| `MAX_DELETIONS_PER_SYNC`                | no       | `50`                     |
| `INCREMENTAL_SYNC_INTERVAL_MS`          | no       | `900000`                 |
| `FULL_SYNC_CRON`                        | no       | `0 3 * * *`              |
| `FULL_SYNC_TIMEZONE`                    | no       | `Europe/Oslo`            |
| `RECONCILE_CHECKUP_CRON`                | no       | `0 4 * * 0` (weekly)     |
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

### aed-reconciler

Long-running BullMQ worker that consumes the `aed-registry-events` queue and
turns registry changes into OpenStreetMap edits. It reads the osm-ingestor's
`osm_aed` and `osm_aed_history` tables to reject no-ops and determine location
ownership before contacting OSM. It still fetches the live node as the final
check before planning an edit.

**Dry-run by default** (`DRY=true`): plans are computed and logged but nothing is
uploaded to OSM. Set `DRY=false` (and provide `OSM_AUTH_TOKEN`) to go live.

**Preview artifacts**: set `PREVIEW_DIR` to write one `.osc` and one `.geojson`
file per changeset into that folder (filenames are timestamp-prefixed, so runs
accumulate a reviewable history over time). Works in both dry and live mode. The
`.osc` opens in JOSM and the `.geojson` in tools like geojson.io, making the
planned edits easy to review before/after an import.

Per-event decisions:

- **Deleted** — the OSM removal is **deferred** by a grace period
  (`DELETION_GRACE_PERIOD_MS`, 7 days by default) via a delayed BullMQ job.
  Registry deactivations are often temporary (expired pads/battery); if the AED
  reactivates within the window the pending removal is cancelled and the existing
  node is reused, avoiding delete-then-recreate churn (and a new node id). If it
  stays deleted through the grace period, the node(s) matching
  `ref:hjertestarterregister` are removed.
- **Created / updated** — if a node already carries the ref, update its managed
  tags (`emergency`, `emergency:phone`, `ref:hjertestarterregister`,
  `opening_hours`, `level`); if several nodes share the ref, keep the one closest
  to the registry location and remove the rest. If no node carries the ref, merge
  into the nearest unmanaged community AED within `MERGE_DISTANCE_METERS` (175 m),
  otherwise create a new node. Mobile AEDs are ignored.

Safeguards:

- Edits nodes only — never ways, relations, or areas.
- Never touches a node tagged `note` or `fixme`.
- Deletes a node only when it is AED-only and not part of any way or relation;
  otherwise it strips just the AED tags so host features and geometry survive.
- The `ref:hjertestarterregister` value is the registry `ASSET_GUID`, matching
  the manual first import; tag values over 255 characters are dropped.
- Moves a node only when the registry location differs by more than
  `MOVE_DISTANCE_METERS` (15 m) **and** the current location was last set by this
  service's own OSM account (`OSM_SERVICE_USERNAME`) — community placements are
  preserved.
- Rate-limits BullMQ job starts to `WORKER_RATE_LIMIT_MAX` per
  `WORKER_RATE_LIMIT_DURATION_MS` (3 jobs per second by default).
- Defers deletions by `DELETION_GRACE_PERIOD_MS` (7 days) so a reactivated AED
  reuses its existing node instead of being recreated.

Requires Redis, read access to the osm-ingestor database, and (in live mode) an
OSM OAuth token. Env vars (see [`.env.example`](services/aed-reconciler/.env.example)):

| Variable                        | Required         | Default                         |
| ------------------------------- | ---------------- | ------------------------------- |
| `DATABASE_URL`                  | yes              | — (osm-ingestor database)       |
| `REDIS_URL`                     | no               | `redis://127.0.0.1:6379`        |
| `QUEUE_NAME`                    | no               | `aed-registry-events`           |
| `WORKER_RATE_LIMIT_MAX`         | no               | `3`                             |
| `WORKER_RATE_LIMIT_DURATION_MS` | no               | `1000`                          |
| `DRY`                           | no               | `true`                          |
| `OSM_API_URL`                   | no               | `https://api.openstreetmap.org` |
| `OSM_AUTH_TOKEN`                | when `DRY=false` | —                               |
| `OSM_SERVICE_USERNAME`          | for node moves   | —                               |
| `MERGE_DISTANCE_METERS`         | no               | `175`                           |
| `MOVE_DISTANCE_METERS`          | no               | `15`                            |
| `DELETION_GRACE_PERIOD_MS`      | no               | `604800000` (7 days)            |
| `PREVIEW_DIR`                   | no               | — (disabled)                    |
| `LOG_LEVEL`                     | no               | `info`                          |

Standalone container:

```bash
docker build -f services/aed-reconciler/Dockerfile -t aed-reconciler .
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL='postgres://user:pass@host.docker.internal:5432/osm_ingestor' \
  -e REDIS_URL='redis://host.docker.internal:6379' \
  aed-reconciler
```

### Database migrations

Both ingestor services embed their Drizzle migrations and apply them
automatically at startup. `aed-reconciler` owns no tables (it only reads the
osm-ingestor's `osm_aed` and `osm_aed_history` tables). During development:

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
node history and batched changeset application. Built on `osm-api` + `zod`.
Consumed by `aed-reconciler`; kept generic for other OSM editing.

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
