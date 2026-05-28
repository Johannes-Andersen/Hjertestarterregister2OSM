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
  HJERTESTARTERREGISTER_CLIENT_ID: z.string().trim().min(1),
  HJERTESTARTERREGISTER_CLIENT_SECRET: z.string().trim().min(1),
  HJERTESTARTERREGISTER_API_BASE_URL: z.string().trim().min(1).optional(),
  HJERTESTARTERREGISTER_OAUTH_TOKEN_URL: z.string().trim().min(1).optional(),
  DATABASE_URL: z.string().trim().min(1),
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
  syncRegistry: "0 0 * * *",
  updateAssets: "* * * * *",
} as const;

export const queueRateLimits = {
  syncRegistry: { max: 1, duration: 1000 },
  updateAssets: { max: 1, duration: 1000 },
} as const;
