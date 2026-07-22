import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import * as z from "zod";

try {
  loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  // .env is optional; environment may already be populated via the platform.
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
  OSM_REPLICATION_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(15_000),
  OSM_RETRY_DELAY_MS: z.coerce.number().int().min(1_000).default(60_000),
  OSM_USER_AGENT: z
    .string()
    .trim()
    .min(3)
    .optional()
    .default(
      "Hjertestarterregister2OSM/1.0 (https://github.com/Johannes-Andersen/Hjertestarterregister2OSM)",
    ),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .optional()
    .default("debug"),
  TZ: z.literal("Europe/Oslo").optional().default("Europe/Oslo"),
});

const env = envSchema.parse(process.env);

export const runtimeEnv = env;

export const logLevel = env.LOG_LEVEL;

export const timezone = env.TZ;
