import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import * as z from "zod";

try {
  loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  // .env is optional; the platform may already provide the environment.
}

const envSchema = z.object({
  DATABASE_URL: z.string().trim().min(1),

  OSM_PLANET_URL: z
    .url()
    .default("https://download.geofabrik.de/europe/norway-latest.osm.pbf"),
  OSM_PLANET_FILE_PATH: z
    .string()
    .trim()
    .min(1)
    .default("data/norway-latest.osm.pbf"),
  OSM_PLANET_RETAIN_DOWNLOADS: z.coerce.number().int().min(1).default(2),
  OSM_PLANET_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  // Local hour (0–23) at which the daily planet check runs. The process runs in
  // Europe/Oslo (see TZ), so this maps to Oslo local time.
  OSM_PLANET_CHECK_HOUR: z.coerce.number().int().min(0).max(23).default(12),

  OSM_REPLICATION_BASE_URL: z
    .string()
    .trim()
    .min(1)
    .default("https://planet.openstreetmap.org/replication/minute")
    .transform((value) => value.replace(/\/+$/, "")),
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
    .default(
      "Hjertestarterregister2OSM/1.0 (https://github.com/Johannes-Andersen/Hjertestarterregister2OSM)",
    ),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  NODE_ENV: z.string().default("development"),
  TZ: z.string().default("Europe/Oslo"),
});

export const env = envSchema.parse(process.env);
