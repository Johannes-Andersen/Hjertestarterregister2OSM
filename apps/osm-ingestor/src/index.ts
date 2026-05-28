import { setupSyncOsmQueue } from "./queues/syncOsmQueue.ts";
import { setupSyncOsmScheduler } from "./schedulers/syncOsmScheduler.ts";
import { setupSyncOsmWorker } from "./workers/syncOsmWorker.ts";

const setupQueues = async () => {
  console.log("Setting up queues...");
  await setupSyncOsmQueue();
  console.log("Queues are set up and ready.");
};

const setupSchedulers = async () => {
  console.log("Setting up schedulers...");
  await setupSyncOsmScheduler();
  console.log("Schedulers are set up and ready.");
};

const setupWorkers = async () => {
  console.log("Setting up workers...");
  await setupSyncOsmWorker();
  console.log("Workers are set up and ready.");
};

const setup = async () => {
  console.log("Setting up OSM ingestor...");
  await setupQueues();
  await setupWorkers();
  await setupSchedulers();
  console.log("Setup complete. OSM ingestor is ready to run.");
};

setup().catch((error) => {
  console.error("Error setting up the OSM ingestor:", error);
  process.exit(1);
});
