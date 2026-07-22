import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import * as z from "zod";

try {
  loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  // .env is optional; the platform may already provide the environment.
}

// Dry-run unless DRY is explicitly "false".
const dryRun = z
  .string()
  .optional()
  .default("true")
  .transform((value) => value.trim().toLowerCase() !== "false");

const positiveInteger = z.coerce.number().int().positive();

const envSchema = z.object({
  // Points at the osm-ingestor database (`osm_aed` + `osm_aed_history`).
  DATABASE_URL: z.string().trim().min(1),
  REDIS_URL: z.string().trim().min(1).default("redis://127.0.0.1:6379"),
  QUEUE_NAME: z.string().trim().min(1).default("aed-registry-events"),
  WORKER_RATE_LIMIT_MAX: positiveInteger.default(3),
  WORKER_RATE_LIMIT_DURATION_MS: positiveInteger.default(1_000),

  OSM_API_URL: z.url().default("https://api.openstreetmap.org"),
  OSM_AUTH_TOKEN: z.string().trim().min(1).optional(),
  OSM_USER_AGENT: z
    .string()
    .trim()
    .min(3)
    .default(
      "Hjertestarterregister2OSM/1.0 (https://github.com/Johannes-Andersen/Hjertestarterregister2OSM)",
    ),
  // OSM username of this service's account. Required to move nodes we placed:
  // when unset, location moves are always skipped to protect community edits.
  OSM_SERVICE_USERNAME: z.string().trim().min(1).optional(),

  DRY: dryRun,
  // Merge a new registry AED into an unmanaged OSM AED within this distance.
  MERGE_DISTANCE_METERS: z.coerce.number().positive().default(175),
  // Move a managed node only when the registry location differs by more than this.
  MOVE_DISTANCE_METERS: z.coerce.number().positive().default(15),

  // When set, write an `.osc` + `.geojson` preview per changeset into this
  // folder (accumulating over time) for community review. Optional.
  PREVIEW_DIR: z.string().trim().min(1).optional(),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  NODE_ENV: z.string().default("development"),
});

export const env = envSchema.parse(process.env);

if (!env.DRY && !env.OSM_AUTH_TOKEN) {
  throw new Error("OSM_AUTH_TOKEN is required when DRY is false (live mode).");
}

export const REF_TAG = "ref:hjertestarterregister";
