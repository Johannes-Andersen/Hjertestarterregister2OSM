import { SyncStoreClient } from "@repo/sync-store";
import { runtimeEnv } from "../config.ts";

export const syncStore = new SyncStoreClient({
  connectionString: runtimeEnv.DATABASE_URL,
});
