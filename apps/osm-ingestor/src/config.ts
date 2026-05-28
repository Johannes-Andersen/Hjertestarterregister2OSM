import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import * as z from "zod";

try {
  loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  // .env is optional; environment may already be populated via the platform.
}

const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().min(0);

const envSchema = z.object({
  DATABASE_URL: z.string().trim().min(1),
  OSM_PLANET_URL: z
    .url()
    .optional()
    .default("https://download.geofabrik.de/europe/norway-latest.osm.pbf"),
  OSM_PLANET_FILE_PATH: z
    .string()
    .trim()
    .min(1)
    .optional()
    .default("data/norway-latest.osm.pbf"),
  OSM_PLANET_RETAIN_DOWNLOADS: z.coerce.number().int().min(1).default(2),
  OSM_REPLICATION_BASE_URL: z
    .string()
    .trim()
    .min(1)
    .optional()
    .default("https://planet.openstreetmap.org/replication/minute")
    .transform((value) => value.replace(/\/+$/, "")),
  OSM_PLANET_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  OSM_MAX_MINUTE_PATCHES_PER_JOB: z.coerce
    .number()
    .int()
    .positive()
    .default(10),
  OSM_USER_AGENT: z
    .string()
    .trim()
    .min(3)
    .optional()
    .default(
      "Hjertestarterregister2OSM/1.0 (https://github.com/Johannes-Andersen/Hjertestarterregister2OSM)",
    ),
  OSM_REGION_FILTER_FILE_PATH: z
    .string()
    .trim()
    .min(1)
    .optional()
    .default("src/data/regionFilter.geojson"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .optional()
    .default("debug"),
  TZ: z.string().trim().min(1).optional().default("Europe/Oslo"),

  // sync-osm policy
  SYNC_OSM_MAX_ATTEMPTS: positiveInt.default(2),
  SYNC_OSM_BACKOFF_DELAY_MS: nonNegativeInt.default(60_000),
  SYNC_OSM_RATE_LIMIT_MAX: positiveInt.default(1),
  SYNC_OSM_RATE_LIMIT_DURATION_MS: positiveInt.default(30_000),
  SYNC_OSM_LOCK_DURATION_MS: positiveInt.default(60_000),
  SYNC_OSM_STALLED_INTERVAL_MS: positiveInt.default(30_000),
  SYNC_OSM_MAX_STALLED_COUNT: nonNegativeInt.default(1),
  SYNC_OSM_REMOVE_ON_COMPLETE_AGE_S: nonNegativeInt.default(7 * 24 * 60 * 60),
  SYNC_OSM_REMOVE_ON_COMPLETE_COUNT: nonNegativeInt.default(200),
  SYNC_OSM_REMOVE_ON_FAIL_AGE_S: nonNegativeInt.default(30 * 24 * 60 * 60),
  SYNC_OSM_REMOVE_ON_FAIL_COUNT: nonNegativeInt.default(500),
});

const env = envSchema.parse(process.env);

export const runtimeEnv = env;

export const logLevel = env.LOG_LEVEL;

export const timezone = env.TZ;

export const schedulerPatterns = {
  syncOsm: "* * * * *",
} as const;

export const queueRateLimits = {
  syncOsm: {
    max: env.SYNC_OSM_RATE_LIMIT_MAX,
    duration: env.SYNC_OSM_RATE_LIMIT_DURATION_MS,
  },
} as const;

export const jobPolicies = {
  syncOsm: {
    attempts: env.SYNC_OSM_MAX_ATTEMPTS,
    backoff: {
      type: "exponential" as const,
      delay: env.SYNC_OSM_BACKOFF_DELAY_MS,
    },
    removeOnComplete: {
      age: env.SYNC_OSM_REMOVE_ON_COMPLETE_AGE_S,
      count: env.SYNC_OSM_REMOVE_ON_COMPLETE_COUNT,
    },
    removeOnFail: {
      age: env.SYNC_OSM_REMOVE_ON_FAIL_AGE_S,
      count: env.SYNC_OSM_REMOVE_ON_FAIL_COUNT,
    },
    deduplicationId: "sync-osm",
  },
} as const;

export const workerPolicies = {
  syncOsm: {
    lockDuration: env.SYNC_OSM_LOCK_DURATION_MS,
    stalledInterval: env.SYNC_OSM_STALLED_INTERVAL_MS,
    maxStalledCount: env.SYNC_OSM_MAX_STALLED_COUNT,
  },
} as const;
