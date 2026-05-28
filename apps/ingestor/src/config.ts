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

  // sync-registry policy
  SYNC_REGISTRY_MAX_ATTEMPTS: positiveInt.default(3),
  SYNC_REGISTRY_BACKOFF_DELAY_MS: nonNegativeInt.default(60_000),
  SYNC_REGISTRY_RATE_LIMIT_MAX: positiveInt.default(1),
  SYNC_REGISTRY_RATE_LIMIT_DURATION_MS: positiveInt.default(60_000),
  SYNC_REGISTRY_LOCK_DURATION_MS: positiveInt.default(60_000),
  SYNC_REGISTRY_STALLED_INTERVAL_MS: positiveInt.default(30_000),
  SYNC_REGISTRY_MAX_STALLED_COUNT: nonNegativeInt.default(1),
  SYNC_REGISTRY_REMOVE_ON_COMPLETE_AGE_S: nonNegativeInt.default(
    7 * 24 * 60 * 60,
  ),
  SYNC_REGISTRY_REMOVE_ON_COMPLETE_COUNT: nonNegativeInt.default(50),
  SYNC_REGISTRY_REMOVE_ON_FAIL_AGE_S: nonNegativeInt.default(30 * 24 * 60 * 60),
  SYNC_REGISTRY_REMOVE_ON_FAIL_COUNT: nonNegativeInt.default(200),

  // update-assets policy
  UPDATE_ASSETS_MAX_ATTEMPTS: positiveInt.default(3),
  UPDATE_ASSETS_BACKOFF_DELAY_MS: nonNegativeInt.default(30_000),
  UPDATE_ASSETS_RATE_LIMIT_MAX: positiveInt.default(1),
  UPDATE_ASSETS_RATE_LIMIT_DURATION_MS: positiveInt.default(5 * 60_000),
  UPDATE_ASSETS_LOCK_DURATION_MS: positiveInt.default(60_000),
  UPDATE_ASSETS_STALLED_INTERVAL_MS: positiveInt.default(30_000),
  UPDATE_ASSETS_MAX_STALLED_COUNT: nonNegativeInt.default(1),
  UPDATE_ASSETS_REMOVE_ON_COMPLETE_AGE_S: nonNegativeInt.default(
    7 * 24 * 60 * 60,
  ),
  UPDATE_ASSETS_REMOVE_ON_COMPLETE_COUNT: nonNegativeInt.default(100),
  UPDATE_ASSETS_REMOVE_ON_FAIL_AGE_S: nonNegativeInt.default(30 * 24 * 60 * 60),
  UPDATE_ASSETS_REMOVE_ON_FAIL_COUNT: nonNegativeInt.default(500),
});

const env = envSchema.parse(process.env);

export const runtimeEnv = env;

export const logLevel = env.LOG_LEVEL;

export const timezone = env.TZ;

export const schedulerPatterns = {
  syncRegistry: "0 10 0 * * *", // Every day at 10 minutes past midnight.
  updateAssets: "*/15 * * * *", // Every 15 minutes.
} as const;

export const queueRateLimits = {
  syncRegistry: {
    max: env.SYNC_REGISTRY_RATE_LIMIT_MAX,
    duration: env.SYNC_REGISTRY_RATE_LIMIT_DURATION_MS,
  },
  updateAssets: {
    max: env.UPDATE_ASSETS_RATE_LIMIT_MAX,
    duration: env.UPDATE_ASSETS_RATE_LIMIT_DURATION_MS,
  },
} as const;

export const jobPolicies = {
  syncRegistry: {
    attempts: env.SYNC_REGISTRY_MAX_ATTEMPTS,
    backoff: {
      type: "exponential" as const,
      delay: env.SYNC_REGISTRY_BACKOFF_DELAY_MS,
    },
    removeOnComplete: {
      age: env.SYNC_REGISTRY_REMOVE_ON_COMPLETE_AGE_S,
      count: env.SYNC_REGISTRY_REMOVE_ON_COMPLETE_COUNT,
    },
    removeOnFail: {
      age: env.SYNC_REGISTRY_REMOVE_ON_FAIL_AGE_S,
      count: env.SYNC_REGISTRY_REMOVE_ON_FAIL_COUNT,
    },
    deduplicationId: "sync-registry",
  },
  updateAssets: {
    attempts: env.UPDATE_ASSETS_MAX_ATTEMPTS,
    backoff: {
      type: "exponential" as const,
      delay: env.UPDATE_ASSETS_BACKOFF_DELAY_MS,
    },
    removeOnComplete: {
      age: env.UPDATE_ASSETS_REMOVE_ON_COMPLETE_AGE_S,
      count: env.UPDATE_ASSETS_REMOVE_ON_COMPLETE_COUNT,
    },
    removeOnFail: {
      age: env.UPDATE_ASSETS_REMOVE_ON_FAIL_AGE_S,
      count: env.UPDATE_ASSETS_REMOVE_ON_FAIL_COUNT,
    },
    deduplicationId: "update-assets",
  },
} as const;

export const workerPolicies = {
  syncRegistry: {
    lockDuration: env.SYNC_REGISTRY_LOCK_DURATION_MS,
    stalledInterval: env.SYNC_REGISTRY_STALLED_INTERVAL_MS,
    maxStalledCount: env.SYNC_REGISTRY_MAX_STALLED_COUNT,
  },
  updateAssets: {
    lockDuration: env.UPDATE_ASSETS_LOCK_DURATION_MS,
    stalledInterval: env.UPDATE_ASSETS_STALLED_INTERVAL_MS,
    maxStalledCount: env.UPDATE_ASSETS_MAX_STALLED_COUNT,
  },
} as const;
