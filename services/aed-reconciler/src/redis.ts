import { Redis } from "ioredis";
import { env } from "./config.ts";

// BullMQ requires `maxRetriesPerRequest: null` on shared connections.
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
