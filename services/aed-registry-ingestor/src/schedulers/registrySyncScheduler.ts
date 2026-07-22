import type { Logger } from "pino";
import { fullSyncProcessor } from "../processors/fullSyncProcessor.ts";
import { incrementalSyncProcessor } from "../processors/incrementalSyncProcessor.ts";
import { getIncrementalCursor } from "../repositories/aedRepository.ts";
import { logger } from "../utils/logger.ts";

export const INCREMENTAL_SYNC_INTERVAL_MS = 15 * 60 * 1000;
export const FULL_SYNC_TIME_ZONE = "Europe/Oslo";
export const FULL_SYNC_HOUR = 15;

const log = logger.child({ module: "scheduler" });

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const osloFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: FULL_SYNC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const getOsloParts = (date: Date): DateParts => {
  const values = Object.fromEntries(
    osloFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return values as unknown as DateParts;
};

const osloLocalTimeToDate = (parts: DateParts): Date => {
  const desiredLocalTimestamp = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let timestamp = desiredLocalTimestamp;

  // Resolve the Europe/Oslo UTC offset. Repeating also handles an offset
  // change between the initial UTC guess and the local target time.
  for (let iteration = 0; iteration < 2; iteration++) {
    const displayed = getOsloParts(new Date(timestamp));
    const displayedLocalTimestamp = Date.UTC(
      displayed.year,
      displayed.month - 1,
      displayed.day,
      displayed.hour,
      displayed.minute,
      displayed.second,
    );
    timestamp += desiredLocalTimestamp - displayedLocalTimestamp;
  }

  return new Date(timestamp);
};

export const getNextFullSyncAt = (now = new Date()): Date => {
  const localNow = getOsloParts(now);
  let target = osloLocalTimeToDate({
    ...localNow,
    hour: FULL_SYNC_HOUR,
    minute: 0,
    second: 0,
  });

  if (target.getTime() <= now.getTime()) {
    const nextLocalDay = new Date(
      Date.UTC(localNow.year, localNow.month - 1, localNow.day + 1),
    );
    target = osloLocalTimeToDate({
      year: nextLocalDay.getUTCFullYear(),
      month: nextLocalDay.getUTCMonth() + 1,
      day: nextLocalDay.getUTCDate(),
      hour: FULL_SYNC_HOUR,
      minute: 0,
      second: 0,
    });
  }

  return target;
};

type SyncKind = "full" | "incremental";

class RegistrySyncScheduler {
  private incrementalTimer?: NodeJS.Timeout;
  private fullTimer?: NodeJS.Timeout;
  private activeSync?: Promise<void>;
  private activeController?: AbortController;
  private stopped = false;

  async start(): Promise<void> {
    this.stopped = false;

    // Catch up immediately after downtime. A new database is bootstrapped with
    // a full snapshot because an incremental cursor does not exist yet.
    await this.runIncremental();

    if (this.stopped) return;
    this.scheduleNextIncrementalSync();
    this.scheduleNextFullSync();

    log.info(
      {
        incrementalIntervalMinutes: 15,
        fullSyncHour: FULL_SYNC_HOUR,
        fullSyncTimeZone: FULL_SYNC_TIME_ZONE,
      },
      "Registry sync timers ready",
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.incrementalTimer) clearTimeout(this.incrementalTimer);
    if (this.fullTimer) clearTimeout(this.fullTimer);
    this.activeController?.abort();
    await this.activeSync?.catch(() => undefined);
  }

  private scheduleNextFullSync(): void {
    const nextRunAt = getNextFullSyncAt();
    this.fullTimer = setTimeout(() => {
      this.scheduleNextFullSync();
      void this.runFull();
    }, nextRunAt.getTime() - Date.now());
    log.info({ nextRunAt }, "Next full registry sync scheduled");
  }

  private scheduleNextIncrementalSync(): void {
    this.incrementalTimer = setTimeout(() => {
      void this.runIncremental().finally(() => {
        if (!this.stopped) this.scheduleNextIncrementalSync();
      });
    }, INCREMENTAL_SYNC_INTERVAL_MS);
  }

  private async runIncremental(): Promise<void> {
    if (this.activeSync) {
      log.info("Skipping incremental sync because another sync is active");
      return;
    }

    let cursor: Date | null;
    try {
      cursor = await getIncrementalCursor();
    } catch (error) {
      log.error({ err: error }, "Could not read registry sync cursor");
      return;
    }
    if (!cursor) {
      await this.run("full", fullSyncProcessor, false);
      return;
    }
    await this.run("incremental", incrementalSyncProcessor, false);
  }

  private async runFull(): Promise<void> {
    if (this.activeSync) {
      log.info("Waiting for active sync before daily full sync");
      await this.activeSync.catch(() => undefined);
    }
    await this.run("full", fullSyncProcessor, true);
  }

  private async run(
    kind: SyncKind,
    processor: (log: Logger, signal?: AbortSignal) => Promise<void>,
    waitForActive: boolean,
  ): Promise<void> {
    if (this.stopped) return;
    if (this.activeSync) {
      if (!waitForActive) return;
      await this.activeSync.catch(() => undefined);
    }
    if (this.stopped) return;

    const controller = new AbortController();
    this.activeController = controller;
    const syncLog = log.child({ sync: kind });
    const task = processor(syncLog, controller.signal);
    this.activeSync = task;

    try {
      await task;
    } catch (error) {
      if (!controller.signal.aborted) {
        syncLog.error({ err: error }, "Registry sync failed");
      }
    } finally {
      if (this.activeSync === task) this.activeSync = undefined;
      if (this.activeController === controller) {
        this.activeController = undefined;
      }
    }
  }
}

export const registrySyncScheduler = new RegistrySyncScheduler();
