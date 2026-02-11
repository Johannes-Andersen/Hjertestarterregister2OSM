# Hjertestarterregister -> OpenStreetMap

Import and synchronization of AEDs (Automated External Defibrillators) from the Norwegian AED registry to OpenStreetMap.

## Repository Structure

This is a monorepo managed by [Turborepo](https://turborepo.dev/). This means multiple apps and packages are stored in the same repository, but are logically separated and deployed independently.

### Apps and Packages

- `website`: the website powered by astro.build
- `reconciler`: the periodic run that imports data from https://hjertestarterregister.113.no/ and publishes it to OpenStreetMap
- `@repo/sync-store`: shared PlanetScale PostgreSQL store for sync runs and issue tracking
- `@repo/hjertestarterregister-api`: typed client package for the Hjertestarterregister API (OAuth + assets endpoints)
- `@repo/osm-sdk`: typed OSM SDK package for authenticated API calls and batched changeset uploads
- `@repo/overpass-sdk`: typed Overpass SDK package for generic query execution with retries and configurable endpoints
- `@repo/typescript-config`: `tsconfig.json`s used throughout the monorepo

### Utilities

The project also utilizes the following tools across the monorepo:

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [Biome](https://biomejs.dev/) for linting and formatting
- [pnpm](https://pnpm.io/) as the package manager

### Build

To build all apps and packages, run the following command:

```
# With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed (recommended)
turbo build

# Without [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation)
pnpm exec turbo build
```

You can build a specific package by using a [filter](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters):

```
# With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed (recommended)
turbo build --filter=website

# Without [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation)
pnpm exec turbo build --filter=docs
```

### Develop

To develop all apps and packages, run the following command:

```
# With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed (recommended)
turbo dev

# Without [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation):
pnpm exec turbo dev
```

You can develop a specific package by using a [filter](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters):

```
# With [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation) installed (recommended)
turbo dev --filter=website

# Without [global `turbo`](https://turborepo.dev/docs/getting-started/installation#global-installation)
pnpm exec turbo dev --filter=website
```

## Sync Dashboard Database Setup

Both `apps/reconciler` and `apps/website` read from the same PostgreSQL database.

1. Set `DATABASE_URL` (PlanetScale PostgreSQL connection string):
   - `apps/reconciler/.env`
   - `apps/website/.env`
2. Create the required tables:

```sh
psql "$DATABASE_URL" -f packages/sync-store/schema.sql
```

After this, each reconciler run writes run outcomes and issues to the database. The Astro website is a read-only interface to show issues and metrics from the latest run.

## Useful Links

- [Hjertestarterregisteret](https://hjertestarterregister.113.no/)
