import type { SyncRunMode } from "@repo/sync-store";
import * as z from "zod";
import packageJson from "../package.json" with { type: "json" };

const envSchema = z.object({
  DRY: z.enum(["true", "false"]).optional().default("true"),
  OSM_AUTH_TOKEN: z.string().trim().min(1).optional(),
  HJERTESTARTERREGISTER_CLIENT_ID: z.string().trim().min(1),
  HJERTESTARTERREGISTER_CLIENT_SECRET: z.string().trim().min(1),
  HJERTESTARTERREGISTER_API_BASE_URL: z.string().trim().min(1).optional(),
  HJERTESTARTERREGISTER_OAUTH_TOKEN_URL: z.string().trim().min(1).optional(),
  DATABASE_URL: z.string().trim().min(1),
});

const env = envSchema.parse(process.env);
const mode: SyncRunMode = env.DRY === "false" ? "live" : "dry-run";

if (mode === "live" && !env.OSM_AUTH_TOKEN) {
  throw new Error("OSM_AUTH_TOKEN is required when DRY=false (live mode).");
}

const currentDir = import.meta.dirname;
const outputDir = `${currentDir}/../out`;

const version = packageJson.version;

export const runtimeEnv = env;

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
    source: "Hjertestarterregisteret: https://hjertestarterregister.113.no",
    "source:date": new Date().toISOString(),
    bot: "yes",
  },
} as const;

export const reconcilerConfig = {
  mode,
  changedLocationDistanceMeters: 50,
  unmanagedMergeDistanceMeters: 20,
  nearbyAedDistanceMeters: 20,
  maxDeleteFraction: 0.5,
  previewOscOutputPath: `${outputDir}/dry-run-changes.osc`,
  previewGeojsonOutputPath: `${outputDir}/dry-run-changes.geojson`,
} as const;
