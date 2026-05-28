import { setupSyncRegistryQueue } from "./queues/syncRegistryQueue.ts";
import { setupUpdateAssetsQueue } from "./queues/updateAssetsQueue.ts";
import { setupSyncRegistryScheduler } from "./schedulers/syncRegistryScheduler.ts";
import { setupUpdateAssetsScheduler } from "./schedulers/updateAssetsScheduler.ts";
import { setupSyncRegistryWorker } from "./workers/syncRegistryWorker.ts";
import { setupUpdateAssetsWorker } from "./workers/updateAssetsWorker.ts";

const setupQueues = async () => {
  console.log("Setting up queues...");
  await Promise.all([setupSyncRegistryQueue(), setupUpdateAssetsQueue()]);
  console.log("Queues are set up and ready.");
};

const setupSchedulers = async () => {
  console.log("Setting up schedulers...");
  await Promise.all([
    setupSyncRegistryScheduler(),
    setupUpdateAssetsScheduler(),
  ]);
  console.log("Schedulers are set up and ready.");
};

const setupWorkers = async () => {
  console.log("Setting up workers...");
  await Promise.all([setupSyncRegistryWorker(), setupUpdateAssetsWorker()]);
  console.log("Workers are set up and ready.");
};

const setup = async () => {
  console.log("Setting up ingestor...");
  await setupQueues();
  await setupWorkers();
  await setupSchedulers();
  console.log("Setup complete. Ingestor is ready to run.");
};

setup().catch((error) => {
  console.error("Error setting up the ingestor:", error);
  process.exit(1);
});
