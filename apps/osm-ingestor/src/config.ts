import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import * as z from "zod";

try {
  console.log("Loading environment variables...");
  loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
  console.log("Environment variables loaded successfully.");
} catch (error) {
  console.error("Failed to load environment variables:", error);
}

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
});

const env = envSchema.parse(process.env);

export const runtimeEnv = env;

export const logLevel = env.LOG_LEVEL;

export const timezone = env.TZ;

export const schedulerPatterns = {
  syncOsm: "* * * * *",
} as const;

export const queueRateLimits = {
  syncOsm: { max: 1, duration: 1000 },
} as const;
