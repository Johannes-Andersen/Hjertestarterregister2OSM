import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import * as z from "zod";

try {
  loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  // .env is optional; the platform may already provide the environment.
}

const envSchema = z.object({
  HJERTESTARTERREGISTER_CLIENT_ID: z.string().trim().min(1),
  HJERTESTARTERREGISTER_CLIENT_SECRET: z.string().trim().min(1),
  HJERTESTARTERREGISTER_API_BASE_URL: z.string().trim().min(1).optional(),
  HJERTESTARTERREGISTER_OAUTH_TOKEN_URL: z.string().trim().min(1).optional(),

  DATABASE_URL: z.string().trim().min(1),
  REDIS_URL: z.string().trim().min(1).default("redis://127.0.0.1:6379"),

  // Full snapshot size. The registry must return fewer rows than this, otherwise
  // we cannot trust deletion reconciliation and refuse to advance.
  REGISTRY_MAX_ROWS: z.coerce.number().int().positive().default(50_000),

  // How often to poll for incremental changes.
  INCREMENTAL_SYNC_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),

  // When to run the daily full sync (cron + timezone).
  FULL_SYNC_CRON: z.string().trim().min(1).default("0 3 * * *"),
  FULL_SYNC_TIMEZONE: z.string().trim().min(1).default("Europe/Oslo"),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  NODE_ENV: z.string().default("development"),
});

export const env = envSchema.parse(process.env);
