import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../config.ts";
import { logger } from "../logger.ts";

const log = logger.child({ module: "db" });

const client = postgres(env.DATABASE_URL, {
  max: 5,
  idle_timeout: 30,
  connect_timeout: 20,
  prepare: false,
  onnotice: (notice) => log.debug({ notice }, "Postgres notice"),
});

export const db = drizzle({ client });

export const migrateDatabase = (): Promise<void> =>
  migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });

export const closeDatabase = (): Promise<void> => client.end({ timeout: 5 });
