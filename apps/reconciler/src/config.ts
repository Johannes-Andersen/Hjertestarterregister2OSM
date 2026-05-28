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
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .optional()
    .default("debug"),
  TZ: z.string().trim().min(1).optional().default("Europe/Oslo"),

  // reconcile-scheduled policy
  RECONCILE_SCHEDULED_MAX_ATTEMPTS: positiveInt.default(3),
  RECONCILE_SCHEDULED_BACKOFF_DELAY_MS: nonNegativeInt.default(60_000),
  RECONCILE_SCHEDULED_RATE_LIMIT_MAX: positiveInt.default(1),
  RECONCILE_SCHEDULED_RATE_LIMIT_DURATION_MS: positiveInt.default(60_000),
  RECONCILE_SCHEDULED_LOCK_DURATION_MS: positiveInt.default(120_000),
  RECONCILE_SCHEDULED_STALLED_INTERVAL_MS: positiveInt.default(60_000),
  RECONCILE_SCHEDULED_MAX_STALLED_COUNT: nonNegativeInt.default(1),
  RECONCILE_SCHEDULED_REMOVE_ON_COMPLETE_AGE_S: nonNegativeInt.default(
    7 * 24 * 60 * 60,
  ),
  RECONCILE_SCHEDULED_REMOVE_ON_COMPLETE_COUNT: nonNegativeInt.default(50),
  RECONCILE_SCHEDULED_REMOVE_ON_FAIL_AGE_S: nonNegativeInt.default(
    30 * 24 * 60 * 60,
  ),
  RECONCILE_SCHEDULED_REMOVE_ON_FAIL_COUNT: nonNegativeInt.default(200),

  // reconcile-changed-aed policy
  RECONCILE_CHANGED_AED_MAX_ATTEMPTS: positiveInt.default(3),
  RECONCILE_CHANGED_AED_BACKOFF_DELAY_MS: nonNegativeInt.default(30_000),
  RECONCILE_CHANGED_AED_RATE_LIMIT_MAX: positiveInt.default(5),
  RECONCILE_CHANGED_AED_RATE_LIMIT_DURATION_MS: positiveInt.default(60_000),
  RECONCILE_CHANGED_AED_LOCK_DURATION_MS: positiveInt.default(60_000),
  RECONCILE_CHANGED_AED_STALLED_INTERVAL_MS: positiveInt.default(30_000),
  RECONCILE_CHANGED_AED_MAX_STALLED_COUNT: nonNegativeInt.default(1),
  RECONCILE_CHANGED_AED_REMOVE_ON_COMPLETE_AGE_S: nonNegativeInt.default(
    7 * 24 * 60 * 60,
  ),
  RECONCILE_CHANGED_AED_REMOVE_ON_COMPLETE_COUNT: nonNegativeInt.default(200),
  RECONCILE_CHANGED_AED_REMOVE_ON_FAIL_AGE_S: nonNegativeInt.default(
    30 * 24 * 60 * 60,
  ),
  RECONCILE_CHANGED_AED_REMOVE_ON_FAIL_COUNT: nonNegativeInt.default(500),
});

const env = envSchema.parse(process.env);

export const runtimeEnv = env;

export const logLevel = env.LOG_LEVEL;

export const timezone = env.TZ;

export const schedulerPatterns = {
  reconcileScheduled: "0 0 12 * * *", // Every day at midday.
} as const;

export const queueRateLimits = {
  reconcileScheduled: {
    max: env.RECONCILE_SCHEDULED_RATE_LIMIT_MAX,
    duration: env.RECONCILE_SCHEDULED_RATE_LIMIT_DURATION_MS,
  },
  reconcileChangedAed: {
    max: env.RECONCILE_CHANGED_AED_RATE_LIMIT_MAX,
    duration: env.RECONCILE_CHANGED_AED_RATE_LIMIT_DURATION_MS,
  },
} as const;

export const jobPolicies = {
  reconcileScheduled: {
    attempts: env.RECONCILE_SCHEDULED_MAX_ATTEMPTS,
    backoff: {
      type: "exponential" as const,
      delay: env.RECONCILE_SCHEDULED_BACKOFF_DELAY_MS,
    },
    removeOnComplete: {
      age: env.RECONCILE_SCHEDULED_REMOVE_ON_COMPLETE_AGE_S,
      count: env.RECONCILE_SCHEDULED_REMOVE_ON_COMPLETE_COUNT,
    },
    removeOnFail: {
      age: env.RECONCILE_SCHEDULED_REMOVE_ON_FAIL_AGE_S,
      count: env.RECONCILE_SCHEDULED_REMOVE_ON_FAIL_COUNT,
    },
    deduplicationId: "reconcile-scheduled",
  },
  reconcileChangedAed: {
    attempts: env.RECONCILE_CHANGED_AED_MAX_ATTEMPTS,
    backoff: {
      type: "exponential" as const,
      delay: env.RECONCILE_CHANGED_AED_BACKOFF_DELAY_MS,
    },
    removeOnComplete: {
      age: env.RECONCILE_CHANGED_AED_REMOVE_ON_COMPLETE_AGE_S,
      count: env.RECONCILE_CHANGED_AED_REMOVE_ON_COMPLETE_COUNT,
    },
    removeOnFail: {
      age: env.RECONCILE_CHANGED_AED_REMOVE_ON_FAIL_AGE_S,
      count: env.RECONCILE_CHANGED_AED_REMOVE_ON_FAIL_COUNT,
    },
  },
} as const;

export const workerPolicies = {
  reconcileScheduled: {
    lockDuration: env.RECONCILE_SCHEDULED_LOCK_DURATION_MS,
    stalledInterval: env.RECONCILE_SCHEDULED_STALLED_INTERVAL_MS,
    maxStalledCount: env.RECONCILE_SCHEDULED_MAX_STALLED_COUNT,
  },
  reconcileChangedAed: {
    lockDuration: env.RECONCILE_CHANGED_AED_LOCK_DURATION_MS,
    stalledInterval: env.RECONCILE_CHANGED_AED_STALLED_INTERVAL_MS,
    maxStalledCount: env.RECONCILE_CHANGED_AED_MAX_STALLED_COUNT,
  },
} as const;
