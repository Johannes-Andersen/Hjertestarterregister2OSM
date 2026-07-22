import { Queue } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { eventJobPolicy } from "../config.ts";
import type { AedEvent, AedEventJobData } from "../events/aedEvent.ts";
import { logger } from "../utils/logger.ts";

export const aedEventQueueName = "aed-registry-events";

const log = logger.child({ module: "queue", queue: aedEventQueueName });
const policy = eventJobPolicy;

export const aedEventQueue = new Queue<AedEventJobData>(aedEventQueueName, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: policy.attempts,
    backoff: policy.backoff,
    removeOnComplete: policy.removeOnComplete,
    removeOnFail: policy.removeOnFail,
  },
});

export const setupAedEventQueue = async (): Promise<void> => {
  await aedEventQueue.waitUntilReady();
  log.info({ policy }, "Queue ready");
};

export const publishAedEvents = async (events: AedEvent[]): Promise<number> => {
  if (events.length === 0) return 0;
  await aedEventQueue.addBulk(
    events.map((event) => ({
      name: event.type,
      data: event.payload,
      opts: { jobId: event.eventId },
    })),
  );
  log.info({ published: events.length }, "Published AED event jobs");
  return events.length;
};
