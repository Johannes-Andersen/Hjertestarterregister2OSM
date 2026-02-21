import * as z from "zod";
import packageJson from "../package.json" with { type: "json" };

const envSchema = z.object({
  DRY: z.enum(["true", "false"]).optional().default("true"),
  OSM_AUTH_TOKEN: z.string().trim().min(1),
  HJERTESTARTERREGISTER_CLIENT_ID: z.string().trim().min(1),
  HJERTESTARTERREGISTER_CLIENT_SECRET: z.string().trim().min(1),
  HJERTESTARTERREGISTER_API_BASE_URL: z.string().trim().min(1).optional(),
  HJERTESTARTERREGISTER_OAUTH_TOKEN_URL: z.string().trim().min(1).optional(),
  DATABASE_URL: z.string().trim().min(1),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .optional()
    .default("debug"),
});

const env = envSchema.parse(process.env);

const version = packageJson.version;

export const runtimeEnv = env;

export const logLevel = env.LOG_LEVEL;

export const databaseCleanupConfig = {
  stuckJobTimeoutMs: 60 * 60 * 3 * 1000, // 3 hours
  oldJobRetentionMs: 30 * 24 * 60 * 60 * 1000, // 30 days
} as const;

export const overpassConfig = {
  apiUrl: "https://overpass-api.de/api/interpreter",
  userAgent: `hjertestarterregister2osm/${version}`,
  queryTimeoutSeconds: 60,
  minRetryDelayMs: 5_000, // 5 seconds
  maxRetries: 6,
} as const;

export const changesetConfig = {
  userAgent: `hjertestarterregister2osm/${version}`,
  commentSubject: "AED locations",
  commonTags: {
    created_by: `hjertestarterregister2osm v${version}`,
    source: "Hjertestarterregisteret",
    "source:url": "https://hjertestarterregister.113.no",
    "source:date": new Date().toISOString(),
    "import:page":
      "https://wiki.openstreetmap.org/w/index.php?title=Import/Catalogue/AED_import_for_Norway",
    bot: "yes",
  },
} as const;

export const reconcilerConfig = {
  mode: env.DRY === "false" ? "live" : "dry-run",
  changedLocationDistanceMeters: 50,
  unmanagedMergeDistanceMeters: 15,
  nearbyAedDistanceMeters: 50,
  maxDeleteFraction: 0.5,
  previewOscOutputPath: `${import.meta.dirname}/../out/dry-run-changes.osc`,
  previewGeojsonOutputPath: `${import.meta.dirname}/../out/dry-run-changes.geojson`,
} as const;
