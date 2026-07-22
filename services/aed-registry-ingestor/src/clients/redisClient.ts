import { Redis } from "ioredis";
import { runtimeEnv } from "../config.ts";

export const redisConnection = new Redis(runtimeEnv.REDIS_URL, {
  maxRetriesPerRequest: null,
});
