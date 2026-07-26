import { Queue } from "bullmq";
import { env } from "./config.ts";
import type { AedEvent } from "./events.ts";
import { redis } from "./redis.ts";

/** Job name for a delayed OSM removal (distinct from the `aed.*` event jobs). */
export const DEFERRED_DELETE_JOB = "deferred-delete";

const deferredDeleteJobId = (assetGuid: string): string =>
  `${DEFERRED_DELETE_JOB}:${assetGuid}`;

// Producer handle on the shared events queue, used only to enqueue (and cancel)
// delayed deferred-delete jobs. The Worker in index.ts consumes them alongside
// the incoming `aed.*` events, so removals stay serialized with everything else.
const queue = new Queue<AedEvent>(env.QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 },
    // Remove terminal jobs so the deterministic job id can be reused if the AED
    // is deleted again after a later reactivation.
    removeOnComplete: true,
    removeOnFail: true,
  },
});

/**
 * Schedule the actual OSM removal to run after the grace period. The job id is
 * derived from the asset guid, so repeated `aed.deleted` events collapse into a
 * single pending job.
 */
export const scheduleDeferredDelete = async (
  event: AedEvent,
): Promise<void> => {
  await queue.add(DEFERRED_DELETE_JOB, event, {
    jobId: deferredDeleteJobId(event.assetGuid),
    delay: env.DELETION_GRACE_PERIOD_MS,
  });
};

/**
 * Cancel a pending deferred delete because the AED came back before the grace
 * period elapsed. Returns whether a pending job was actually removed.
 */
export const cancelDeferredDelete = async (
  assetGuid: string,
): Promise<boolean> => {
  const job = await queue.getJob(deferredDeleteJobId(assetGuid));
  if (!job) return false;
  await job.remove();
  return true;
};

export const closeQueue = (): Promise<void> => queue.close();
