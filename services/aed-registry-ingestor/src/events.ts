import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import type { Logger } from "pino";
import type { AedRow } from "./db/schema.ts";
import { redis } from "./redis.ts";

export const eventsQueueName = "aed-registry-events";

export type AedEventType = "aed.created" | "aed.updated" | "aed.deleted";
export type AedEventSource = "full-sync" | "incremental-sync";

const serializeAed = (row: AedRow) => ({
  assetId: row.assetId,
  assetGuid: row.assetGuid,
  siteName: row.siteName,
  siteAddress: row.siteAddress,
  siteLatitude: row.siteLatitude,
  siteLongitude: row.siteLongitude,
  siteFloorNumber: row.siteFloorNumber,
  sitePostCode: row.sitePostCode,
  sitePostArea: row.sitePostArea,
  siteDescription: row.siteDescription,
  isMobile: row.isMobile,
  createdDate: row.createdDate.toISOString(),
  modifiedDate: row.modifiedDate.toISOString(),
  activeFromDate: row.activeFromDate?.toISOString() ?? null,
  activeToDate: row.activeToDate?.toISOString() ?? null,
  openingHoursLimited: row.openingHoursLimited,
  openingHoursClosedHolidays: row.openingHoursClosedHolidays,
  openingHours: row.openingHours,
});

export type SerializedAed = ReturnType<typeof serializeAed>;

export interface AedEvent {
  eventId: string;
  type: AedEventType;
  source: AedEventSource;
  occurredAt: string;
  assetId: number;
  assetGuid: string;
  aed: SerializedAed;
}

export const buildAedEvent = (
  type: AedEventType,
  source: AedEventSource,
  row: AedRow,
): AedEvent => ({
  eventId: randomUUID(),
  type,
  source,
  occurredAt: new Date().toISOString(),
  assetId: row.assetId,
  assetGuid: row.assetGuid,
  aed: serializeAed(row),
});

const queue = new Queue<AedEvent>(eventsQueueName, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { age: 30 * 24 * 60 * 60, count: 100_000 },
    removeOnFail: { age: 90 * 24 * 60 * 60 },
  },
});

export const publishAedEvents = async (
  events: AedEvent[],
  log: Logger,
): Promise<number> => {
  if (events.length === 0) return 0;
  await queue.addBulk(
    events.map((event) => ({
      name: event.type,
      data: event,
      opts: { jobId: event.eventId },
    })),
  );
  log.info({ published: events.length }, "Published AED events");
  return events.length;
};

export const closeEventsQueue = (): Promise<void> => queue.close();
