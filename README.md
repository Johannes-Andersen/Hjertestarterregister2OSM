# Hjertestarterregister -> OpenStreetMap

Automated reconciliation between the Norwegian AED registry and OpenStreetMap.

The project has two runtime parts:

- `apps/reconciler`: loads registry + OSM data, plans and executes sync changes, stores metrics/issues.
- `apps/website`: operational dashboard for run history and current issues.

## Monorepo Overview

This repo uses `pnpm` workspaces + Turborepo.

- `apps/reconciler`: sync worker
- `apps/website`: Dashboard written in Astro and deployed on Cloudflare Workers
- `packages/hjertestarterregister-sdk`: typed API client (OAuth + assets endpoints)
- `packages/overpass-sdk`: typed Overpass API client with retries
- `packages/osm-sdk`: typed OSM API client
- `packages/sync-store`: PostgreSQL data layer for runs/issues
- `packages/typescript-config`: shared TS configs

## Prerequisites

- Node `v25` (see `.nvmrc`)
- `pnpm` `v10`
- PostgreSQL database (for run/issue persistence)
- Hjertestarterregister API credentials
- OSM OAuth bearer token (live mode only)
- For website deployment/local preview with bindings: Cloudflare + configured Hyperdrive/KV in `apps/website/wrangler.jsonc`

## Install

```bash
pnpm install
```

## Environment

`apps/reconciler` reads environment variables via `apps/reconciler/src/config.ts`.

Required:

- `HJERTESTARTERREGISTER_CLIENT_ID`
- `HJERTESTARTERREGISTER_CLIENT_SECRET`
- `DATABASE_URL`

Required only for live OSM writes:

- `OSM_AUTH_TOKEN` (required when `DRY=false`)

Optional:

- `DRY` (`true` by default; set `false` for live mode)
- `HJERTESTARTERREGISTER_API_BASE_URL`
- `HJERTESTARTERREGISTER_OAUTH_TOKEN_URL`

Example `apps/reconciler/.env`:

```bash
DRY=true
DATABASE_URL=postgres://user:pass@host:5432/db
HJERTESTARTERREGISTER_CLIENT_ID=...
HJERTESTARTERREGISTER_CLIENT_SECRET=...
# OSM_AUTH_TOKEN=...   # required when DRY=false
```

Notes:

- In dry-run mode, no OSM upload is performed. Planned changes are written to `apps/reconciler/out/`.
- In live mode, planned changes are uploaded to OSM using one or more changesets.

## Database Setup

Create the sync tables:

```bash
psql "$DATABASE_URL" -f packages/sync-store/schema.sql
```

This creates:

- `sync_runs`
- `sync_run_issues`

## Running the Reconciler

```bash
node --env-file=./apps/reconciler/.env apps/reconciler/src/index.ts
```

What to expect:

- Starts a run in `sync_runs`
- Builds a change plan
- Dry-run: writes `.osc` + `.geojson` previews to `apps/reconciler/out/`
- Live: uploads OSM changes
- Stores final metrics and issues

## Running the Website

For local UI development:

```bash
pnpm --filter website dev
```

For local worker preview with Cloudflare bindings:

```bash
pnpm --filter website preview
```

The website reads DB connection via Cloudflare Hyperdrive binding:

- `Astro.locals.runtime.env.HYPERDRIVE.connectionString`

## Code Quality Commands

```bash
pnpm lint
pnpm check-types
pnpm build
```

## Reconciler Rules

High-level behavior:

- Fetch OSM AED elements from Overpass using the same Norway polygon used for registry filtering.
- Fetch registry assets and ignore assets outside Norway polygon.
- Respect OSM opt-out via `note=*`.
- Resolve duplicate managed refs by keeping closest-to-registry node and deleting all other duplicates in that ref group.
- Keep manually moved managed nodes when move is within tolerance (tags can still update).
- Enforce standalone AED nodes: if AED is on a mixed-purpose POI (`amenity|leisure|tourism|shop|office|craft|club`), strip AED tags from source and create a dedicated AED node.
- Try linking unmanaged OSM AED nodes to nearest unmatched registry AED within distance threshold.
- Create new nodes for remaining unmatched registry AEDs unless a nearby AED already exists.

[Thresholds/configurations](./apps/reconciler/src/config.ts).

## Issue Types

Current issue types emitted by reconciler:

- `register_aed_outside_norway`
- `osm_node_missing_ref`
- `osm_node_note_opt_out`
- `osm_duplicate_register_ref`
- `aed_split_non_standalone_node`
- `managed_node_location_within_tolerance`
- `skipped_create_nearby`
- `skipped_delete_not_aed_only`

## Useful Links

- Registry: https://hjertestarterregister.113.no/
- OSM: https://www.openstreetmap.org/
