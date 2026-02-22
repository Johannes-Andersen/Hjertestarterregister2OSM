# Hjertestarterregister -> OpenStreetMap

Automated reconciliation between the [Norwegian AED registry (Hjertestarterregisteret)](https://hjertestarterregister.113.no/) and [OpenStreetMap](https://www.openstreetmap.org/).

The project has two runtime parts:

- `apps/reconciler`: loads registry + OSM data, plans and executes sync changes, stores metrics and issues.
- `apps/website`: operational dashboard for run history and current issues.

## Monorepo Overview

This repo uses `pnpm` workspaces + Turborepo.

| Path                                 | Description                                                  |
| ------------------------------------ | ------------------------------------------------------------ |
| `apps/reconciler`                    | Sync worker that reconciles registry data with OSM           |
| `apps/website`                       | Astro dashboard deployed on Cloudflare Workers               |
| `packages/hjertestarterregister-sdk` | Typed API client for the registry (OAuth + assets endpoints) |
| `packages/overpass-sdk`              | Typed Overpass API client with retries                       |
| `packages/osm-sdk`                   | Typed OSM API client                                         |
| `packages/sync-store`                | PostgreSQL data layer for runs and issues                    |
| `packages/typescript-config`         | Shared TypeScript configs                                    |

## Prerequisites

- Node.js `v25` (see `.nvmrc`)
- `pnpm` `v10`
- PostgreSQL database (for run/issue persistence)
- Hjertestarterregister API credentials
- OSM OAuth bearer token
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
- `OSM_AUTH_TOKEN`

Optional:

- `DRY` (`true` by default; set `false` for live mode)
- `HJERTESTARTERREGISTER_API_BASE_URL`
- `HJERTESTARTERREGISTER_OAUTH_TOKEN_URL`
- `LOG_LEVEL` (`fatal`, `error`, `warn`, `info`, `debug`, `trace`; default `debug`)

Example `apps/reconciler/.env`:

```bash
DRY=true
DATABASE_URL=postgres://user:pass@host:5432/db
HJERTESTARTERREGISTER_CLIENT_ID=...
HJERTESTARTERREGISTER_CLIENT_SECRET=...
OSM_AUTH_TOKEN=...
```

Notes:

- Preview files are written to `apps/reconciler/out/` (`.osc` + `.geojson`)
- In dry-run mode, upload to OSM is skipped.
- In live mode, planned changes are uploaded to OSM using batched changesets.

## Database Setup

Create the sync tables, indexes, and `pg_cron` cleanup jobs:

```bash
psql "$DATABASE_URL" -f packages/sync-store/schema.sql
```

This creates:

- `sync_runs`
- `sync_run_issues`
- `pg_cron` jobs:
  - `sync-mark-stuck-runs` (`*/10 * * * *`)
  - `sync-prune-old-runs` (`15 3 * * *`)

> [!NOTE]
> `pg_cron` must be enabled in your Postgres settings before applying `packages/sync-store/schema.sql`.

## Running the Reconciler

```bash
node --env-file=./apps/reconciler/.env apps/reconciler/src/index.ts
```

## Running the Website

For local UI development:

```bash
pnpm --filter website dev
```

For local worker preview with Cloudflare bindings:

```bash
pnpm --filter website preview
```

The website reads the database connection via a Cloudflare Hyperdrive binding:

- `Astro.locals.runtime.env.HYPERDRIVE.connectionString`

## Code Quality

```bash
pnpm lint        # Biome lint
pnpm format      # Biome format
pnpm check       # Biome check
pnpm check-types # TypeScript type-check
pnpm build       # Full build
```

## Reconciler Flow

`apps/reconciler/src/index.ts` runs one job:

1. `reconciliation` (fetch, plan, safeguard, write previews, optionally upload)

Run cleanup is handled by `pg_cron` directly in the database.

The diagram and numbered steps below reflect the current implementation.

### Flow Diagram

```mermaid
flowchart TD
    Start([Start]) --> InitRun["Start sync run in DB<br/>(sync_runs)"]
    InitRun --> LoadReg["loadRegistryData<br/>(fetch assets, validate required fields,<br/>filter outside Norway, record issues)"]
    LoadReg --> LoadOSM["loadOverpassData<br/>(query nwr emergency=defibrillator,<br/>filter nodes only, record osm_not_a_node issues)"]
    LoadOSM --> HasOverpass{"Any OSM AED nodes?"}
    HasOverpass -->|No| AbortNoOverpass["Abort run<br/>(safety: no Overpass AED nodes)"]
    HasOverpass -->|Yes| Extract["aedExtraction<br/>(for non-AED-only nodes:<br/>strip AED tags + create standalone AED node)"]

    Extract --> DeleteRemoved["deleteRemoved<br/>(managed refs missing in registry,<br/>delete only if AED-only)"]
    DeleteRemoved --> ResolveDup["resolveDuplicates<br/>(duplicate managed refs,<br/>keep one, delete AED-only duplicates)"]
    ResolveDup --> Update["updateExisting<br/>(skip duplicates and opt-outs,<br/>apply tag updates, move only if >100m)"]
    Update --> Add["addNew<br/>(unmanaged merge <=175m,<br/>else create new node)"]

    Add --> Metrics["Aggregate task plans<br/>and add run metrics"]
    Metrics --> DeleteGuard{"Delete fraction<br/>> maxDeleteFraction?"}
    DeleteGuard -->|Yes| AbortDelete["Abort run<br/>(mass-delete safeguard)"]
    DeleteGuard -->|No| Merge["Merge all task ChangePlans"]
    Merge --> Write["Write preview files<br/>(.osc + .geojson)"]
    Write --> Mode{"Mode?"}
    Mode -->|dry-run| Dry["Skip upload"]
    Mode -->|live| Live["uploadChanges<br/>(batched OSM changesets)"]

    Dry --> Success["Mark run success"]
    Live --> Success
    AbortNoOverpass --> Failed["Mark run failed<br/>(error_message)"]
    AbortDelete --> Failed
    Success --> Done([Done])
    Failed --> Done
```

### Step-by-step

1. **Scheduled DB cleanup (`pg_cron`)** — Outside the reconciler process, the database runs:
   - `sync-mark-stuck-runs`: every 10 minutes, marks runs older than 3 hours in `running` state as `failed`.
   - `sync-prune-old-runs`: daily at 03:15, deletes completed runs older than 30 days.

2. **Start sync run** — A new run record is created in `sync_runs` with mode `dry-run` or `live`.

3. **Load registry AEDs** — `loadRegistryData` fetches assets from Hjertestarterregister and filters out invalid data. Required fields are `ASSET_GUID`, `SITE_LATITUDE`, `SITE_LONGITUDE`, and `SITE_NAME`. Assets outside the Norway polygon are excluded and logged as issues.

4. **Load Overpass AED elements** — `loadOverpassData` queries Overpass for `nwr["emergency"="defibrillator"]` inside the Norway polygon. Non-node elements are dropped and recorded as `osm_not_a_node` issues. If zero OSM AED nodes remain, the run aborts immediately for safety.

5. **Extract standalone AEDs from mixed nodes** — `aedExtraction` scans all OSM nodes and identifies non-AED-only nodes (for example, POIs carrying both AED and primary-feature tags like `amenity` or `shop`).
   - Nodes with a `note` or `fixme` tag are skipped and logged as `osm_node_note_opt_out`.
   - For other mixed nodes, the live node is fetched from OSM, AED tags are stripped from the source node, and a new standalone AED node is planned at the same coordinates.

6. **Delete removed managed nodes** — `deleteRemoved` handles managed nodes (`ref:hjertestarterregister`) whose ref is no longer present in the registry:
   - The live node is fetched from OSM.
   - If the node is AED-only, deletion is planned.
   - If not AED-only, delete is skipped and `skipped_delete_not_aed_only` is recorded.

7. **Resolve duplicate managed refs** — `resolveDuplicates` groups managed nodes by `ref:hjertestarterregister` and resolves groups with more than one node:
   - Keep the best candidate (closest to registry location, then lowest node ID).
   - For remaining duplicates, fetch live node and delete only if AED-only; otherwise record `skipped_delete_not_aed_only`.

8. **Update existing managed nodes** — `updateExisting` processes managed nodes that still exist in the registry:
   - Duplicate refs are skipped (handled by step 7).
   - Opted-out nodes (`note` or `fixme`) are skipped with `osm_node_note_opt_out`.
   - Tag diffs are computed from `mapRegisterAedToOsmTags`.
   - Location is moved only when distance exceeds `changedLocationDistanceMeters` (100 m).
   - Distances between 2 m and 100 m create `managed_node_location_within_tolerance`.
   - Planned modifies use live node version from OSM.

9. **Merge or create missing registry AEDs** — `addNew` iterates registry AEDs not already managed:
   - If closest unmanaged node is within `unmanagedMergeDistanceMeters` (175 m), plan a merge (modify existing node with registry tags).
   - If that nearby unmanaged node is opted-out, merge is skipped with `osm_node_note_opt_out`.
   - If no nearby unmanaged node is found, create a new AED node.

10. **Aggregate metrics + deletion safeguard** — Change counts are aggregated across all tasks and written to `sync_runs`. Then a safety check aborts if `planned_deletes / total_osm_nodes > maxDeleteFraction` (default `0.5`).

11. **Write files + optional upload** — All task plans are merged, preview files are written (`apps/reconciler/out/dry-run-changes.osc` and `.geojson`), and then:
    - **Dry-run:** upload is skipped.
    - **Live:** `uploadChanges` sends batched changesets to OSM.

12. **Complete run status** — On success, run status is set to `success`. On any thrown error, the run is marked `failed` with `error_message`, and the error is re-thrown.

### Configurable Thresholds

| Parameter                       | Default | Description                                                                |
| ------------------------------- | ------- | -------------------------------------------------------------------------- |
| `changedLocationDistanceMeters` | 100 m   | Managed node is moved only if registry location differs by more than this  |
| `unmanagedMergeDistanceMeters`  | 175 m   | Max distance to merge an unmanaged OSM node with a registry AED            |
| `maxDeleteFraction`             | 0.5     | Abort run if planned deletions exceed this fraction of total OSM AED nodes |

See [apps/reconciler/src/config.ts](apps/reconciler/src/config.ts) for all configuration.

## Issue Types

| Issue Type                               | Severity | Description                                                                              |
| ---------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `register_aed_outside_norway`            | warning  | Registry AED has coordinates outside the Norway polygon                                  |
| `register_missing_required_data`         | warning  | Registry asset is missing required fields (`ASSET_GUID`, location, or `SITE_NAME`)       |
| `osm_not_a_node`                         | error    | OSM element with AED details is not a node and is therefore excluded from automation     |
| `osm_node_note_opt_out`                  | warning  | Node has a `note` or `fixme` tag and is excluded from extraction/update/merge automation |
| `managed_node_location_within_tolerance` | warning  | Managed node location differs from registry but is within the move tolerance             |
| `skipped_delete_not_aed_only`            | warning  | Node deletion skipped because it has primary-feature tags (amenity, shop, etc.)          |

## Useful Links

- [Hjertestarterregisteret](https://hjertestarterregister.113.no/)
- [OpenStreetMap](https://www.openstreetmap.org/)
- [Community discussion thread](https://community.openstreetmap.org/t/import-av-hjertestarterdata-fra-hjertestarterregisteret-til-openstreetmap/141501)
