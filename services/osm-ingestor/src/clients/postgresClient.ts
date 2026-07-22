import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { runtimeEnv } from "../config.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ module: "postgres" });

export const postgresClient = postgres(runtimeEnv.DATABASE_URL, {
  max: 5,
  idle_timeout: 30,
  connect_timeout: 20,
  prepare: false,
  onnotice: (notice) => log.debug({ notice }, "Postgres notice"),
});

export const db = drizzle({ client: postgresClient });

export const closeDatabase = async (): Promise<void> => {
  await postgresClient.end({ timeout: 5 });
};
