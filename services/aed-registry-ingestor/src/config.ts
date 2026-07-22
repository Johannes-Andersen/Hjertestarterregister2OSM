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
  REDIS_URL: z
    .string()
    .trim()
    .min(1)
    .optional()
    .default("redis://127.0.0.1:6379"),
  REGISTRY_MAX_ROWS: positiveInt.default(50_000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .optional()
    .default("debug"),

  EVENT_REMOVE_ON_COMPLETE_AGE_S: nonNegativeInt.default(30 * 24 * 60 * 60),
  EVENT_REMOVE_ON_COMPLETE_COUNT: nonNegativeInt.default(100_000),
  EVENT_REMOVE_ON_FAIL_AGE_S: nonNegativeInt.default(90 * 24 * 60 * 60),
  EVENT_REMOVE_ON_FAIL_COUNT: nonNegativeInt.default(100_000),
});

export const runtimeEnv = envSchema.parse(process.env);

export const logLevel = runtimeEnv.LOG_LEVEL;

export const eventJobPolicy = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 30_000 },
  removeOnComplete: {
    age: runtimeEnv.EVENT_REMOVE_ON_COMPLETE_AGE_S,
    count: runtimeEnv.EVENT_REMOVE_ON_COMPLETE_COUNT,
  },
  removeOnFail: {
    age: runtimeEnv.EVENT_REMOVE_ON_FAIL_AGE_S,
    count: runtimeEnv.EVENT_REMOVE_ON_FAIL_COUNT,
  },
} as const;
