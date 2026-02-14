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

The reconciler runs as a single sequential pipeline. The diagram and numbered steps below describe the full flow from start to finish.

### Flow Diagram

```mermaid
flowchart TD
    Start([Start]) --> InitRun["Start sync run in DB<br/>(sync_runs)"]
    InitRun --> LoadOSM["Load OSM AED elements<br/>via Overpass API<br/>(emergency=defibrillator<br/>within Norway polygon)"]
    InitRun --> LoadReg["Fetch registry assets<br/>via Hjertestarterregister API"]

    LoadOSM --> ClassifyOSM{"Classify each<br/>AED node"}
    ClassifyOSM -->|"Has note tag"| OptOut["Opted-out<br/>(skip, record issue)"]
    ClassifyOSM -->|"Has ref:hjertestarterregister"| Managed["Managed node"]
    ClassifyOSM -->|"No ref tag"| Unmanaged["Unmanaged node"]

    LoadReg --> FilterReg{"Inside Norway<br/>polygon?"}
    FilterReg -->|No| SkipReg["Skip<br/>(record issue)"]
    FilterReg -->|Yes| ValidReg["Valid registry AED"]
    FilterReg -->|"Missing required fields"| DiscardReg["Discard<br/>(invalid asset)"]

    Managed --> DedupRefs{"Duplicate<br/>ref groups?"}
    DedupRefs -->|Yes| ResolveDup["Keep closest node to<br/>registry location,<br/>delete duplicates<br/>(if AED-only)"]
    DedupRefs -->|No| DedupDone["Unique managed nodes"]
    ResolveDup --> DedupDone

    DedupDone --> PlanDelete{"Managed ref still<br/>in registry?"}
    PlanDelete -->|No| DeleteNode["Plan delete<br/>(if AED-only node)"]
    PlanDelete -->|Yes| PlanUpdate

    DeleteNode --> PlanUpdate{"Tags or location<br/>changed?"}
    PlanUpdate -->|"Non-standalone node<br/>(mixed-purpose POI)"| SplitNode["Strip AED tags from<br/>source node, create<br/>new standalone AED node"]
    PlanUpdate -->|"Location moved ><br/>50m threshold"| MoveUpdate["Plan tag + location update"]
    PlanUpdate -->|"Location moved ≤<br/>50m threshold"| TagOnly["Plan tag-only update<br/>(keep OSM location)"]
    PlanUpdate -->|"No changes"| Unchanged["Mark unchanged"]

    SplitNode --> LinkPhase
    MoveUpdate --> LinkPhase
    TagOnly --> LinkPhase
    Unchanged --> LinkPhase

    Unmanaged --> LinkPhase{"Link unmanaged nodes<br/>to nearest unmatched<br/>registry AED ≤ 20m"}
    LinkPhase -->|Match found| LinkNode["Add ref tag + registry<br/>tags to unmanaged node<br/>(split if non-standalone)"]
    LinkPhase -->|No match| MissingRef["Record missing ref issue"]

    ValidReg --> CreatePhase
    LinkNode --> CreatePhase
    MissingRef --> CreatePhase
    CreatePhase{"Unmatched registry<br/>AEDs remaining?"}
    CreatePhase -->|"Nearby AED exists<br/>≤ 20m"| SkipCreate["Skip create<br/>(record issue)"]
    CreatePhase -->|"No nearby AED"| CreateNode["Plan create<br/>new AED node"]

    SkipCreate --> SafetyCheck
    CreateNode --> SafetyCheck

    SafetyCheck{"Deletions exceed<br/>safety threshold?"}
    SafetyCheck -->|Yes| Abort["Abort run<br/>(persist error)"]
    SafetyCheck -->|No| Execute

    Execute{"Mode?"}
    Execute -->|dry-run| DryRun["Write .osc + .geojson<br/>preview files to out/"]
    Execute -->|live| LiveRun["Upload changes to OSM<br/>via batched changesets"]

    DryRun --> Persist
    LiveRun --> Persist
    Abort --> Persist
    Persist["Persist issues + metrics<br/>to sync_runs / sync_run_issues"]
    Persist --> Done([Done])
```

### Step-by-step

1. **Start sync run** — A new run record is created in `sync_runs` with the current mode (`dry-run` or `live`).

2. **Load OSM AED elements** — Queries the Overpass API for all `emergency=defibrillator` elements within a Norway boundary polygon. Only node elements are processed further (ways/relations are kept for nearby-checks only).

3. **Classify OSM nodes** — Each AED node is classified into one of three buckets:
   - **Opted-out** — Has a `note` tag. The node is excluded from all automation and an `osm_node_note_opt_out` issue is recorded. If it has a `ref:hjertestarterregister` tag, that ref is marked as matched so the registry AED won't be re-created.
   - **Managed** — Has a `ref:hjertestarterregister` tag (linked to a registry AED).
   - **Unmanaged** — An AED node without a registry ref tag.

4. **Load registry AEDs** — Fetches all assets from the Hjertestarterregister API. Each asset is validated (must have `ASSET_GUID`, `SITE_LATITUDE`, `SITE_LONGITUDE`), then filtered to only include locations inside the Norway polygon. Assets outside Norway produce a `register_aed_outside_norway` issue.

5. **Resolve duplicate refs** — Groups managed nodes by `ref:hjertestarterregister`. For each group with more than one node:
   - Nodes are sorted by distance to the registry location (closest first, then by node ID as tiebreaker).
   - The closest node is kept; all others are planned for deletion.
   - Deletion is skipped (with a `skipped_delete_not_aed_only` issue) if the node has primary-feature tags (e.g. `amenity`, `shop`, `tourism`). Supplementary tags like `source`, `wheelchair`, `check_date` etc. do not block deletion.
   - An `osm_duplicate_register_ref` issue is recorded for each duplicate group.
   - Deleted duplicate nodes are pruned from the nearby-check list so they don't interfere with subsequent create decisions.

6. **Plan deletes** — For each deduplicated managed node whose `ref:hjertestarterregister` value no longer exists in the registry:
   - If the node is AED-only (no primary-feature tags like `amenity`, `shop`, etc.), plan a delete.
   - If the node has primary-feature tags, skip deletion and record a `skipped_delete_not_aed_only` issue.
   - In live mode, the node is re-fetched from the OSM API to use the current version.
   - Deleted nodes are pruned from the nearby-check list so they don't block creation of a different nearby registry AED.

7. **Plan updates** — For each managed node that still matches a registry AED:
   - **Non-standalone conflict** — If the node is a mixed-purpose POI (`amenity`, `leisure`, `tourism`, `shop`, `office`, `craft`, `club`), AED tags are stripped from the source node and a new standalone AED node is created at the registry location. In live mode, the node is re-fetched from the OSM API to verify the conflict still exists before committing to a split. Records an `aed_split_non_standalone_node` issue.
   - **Location moved > 50 m** — The node is moved to the registry coordinates and tags are updated.
   - **Location moved ≤ 50 m** — Only tags are updated; the OSM location is kept (records a `managed_node_location_within_tolerance` issue).
   - **No changes** — Marked as unchanged.

8. **Link unmanaged nodes** — For each unmanaged AED node (no `ref:hjertestarterregister`), find all unmatched registry AEDs within 20 m:
   - All (node, registry AED, distance) pairs within range are collected, sorted by distance (closest first), and processed greedily — each node and each registry AED can only be linked once. If a node's closest match is claimed by another node, it falls back to the next-closest match.
   - If the node is a non-standalone POI, the same split logic from step 7 applies.
   - Otherwise, the registry tags (including the ref) are merged onto the existing node.
   - Unmanaged nodes that could not be linked produce an `osm_node_missing_ref` issue.

9. **Plan creates** — For each registry AED that is still unmatched after steps 5–8:
   - If any existing AED element (node, way, or relation) is within 20 m, creation is skipped and a `skipped_create_nearby` issue is recorded.
   - Otherwise, a new AED node is planned with tags mapped from the registry data.

10. **Mass deletion safeguard** — If the number of planned deletions exceeds a configurable fraction (default 50%) of total OSM AED nodes, the run is aborted with an error. This protects against registry API outages or truncated responses that would otherwise cause the reconciler to delete valid OSM data.

11. **Execute change plan** — The accumulated create/modify/delete plan is executed based on the mode:
    - **Dry-run** — Writes an `.osc` (OSM Change XML) and a `.geojson` preview file to `apps/reconciler/out/`.
    - **Live** — Uploads changes to OSM via batched changesets using the OSM API.

12. **Persist results** — All collected issues are stored in `sync_run_issues` and final metrics (counts of created, updated, deleted, unchanged, skipped) are saved to `sync_runs`. On failure, issues and an error message are persisted before re-throwing.

### Configurable Thresholds

| Parameter                       | Default | Description                                                                  |
| ------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `changedLocationDistanceMeters` | 50 m    | Managed node is moved only if registry location differs by more than this    |
| `unmanagedMergeDistanceMeters`  | 20 m    | Max distance to auto-link an unmanaged OSM node to a registry AED            |
| `nearbyAedDistanceMeters`       | 20 m    | Skip creating a new node if any existing AED element is within this distance |
| `maxDeleteFraction`             | 0.5     | Abort run if planned deletions exceed this fraction of total OSM AED nodes   |

See [apps/reconciler/src/config.ts](apps/reconciler/src/config.ts) for all configuration.

## Issue Types

| Issue Type                               | Severity | Description                                                                     |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| `register_aed_outside_norway`            | warning  | Registry AED has coordinates outside the Norway polygon                         |
| `osm_node_missing_ref`                   | warning  | Unmanaged AED node could not be linked to any registry AED                      |
| `osm_node_note_opt_out`                  | warning  | Node has a `note` tag and is excluded from automation                           |
| `osm_duplicate_register_ref`             | error    | Multiple OSM nodes share the same `ref:hjertestarterregister` value             |
| `aed_split_non_standalone_node`          | warning  | AED tags were split off a mixed-purpose POI into a dedicated node               |
| `managed_node_location_within_tolerance` | warning  | Managed node location differs from registry but is within the move tolerance    |
| `skipped_create_nearby`                  | warning  | New node creation skipped because a nearby AED already exists                   |
| `skipped_delete_not_aed_only`            | warning  | Node deletion skipped because it has primary-feature tags (amenity, shop, etc.) |

## Useful Links

- [Hjertestarterregisteret](https://hjertestarterregister.113.no/)
- [OpenStreetMap](https://www.openstreetmap.org/)
- [Community discussion thread](https://community.openstreetmap.org/t/import-av-hjertestarterdata-fra-hjertestarterregisteret-til-openstreetmap/141501)
