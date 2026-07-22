import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "../clients/postgresClient.ts";

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

export const migrateDatabase = async (): Promise<void> => {
  await migrate(db, { migrationsFolder });
};
