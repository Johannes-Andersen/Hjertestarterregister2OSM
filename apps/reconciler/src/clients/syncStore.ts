import { SyncStoreClient } from "@repo/sync-store";

export const syncStore = new SyncStoreClient({
  connectionString: process.env.DATABASE_URL ?? "",
});
