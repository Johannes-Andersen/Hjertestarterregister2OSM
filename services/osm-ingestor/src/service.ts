import type { Logger } from "pino";
import { runtimeEnv, timezone } from "./config.ts";
import {
  ensureLatestPlanet,
  syncMinuteChanges,
} from "./processors/osmSyncProcessor.ts";

const osloClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface ClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsAt = (date: Date): ClockParts =>
  Object.fromEntries(
    osloClock
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as unknown as ClockParts;

const localTimeToUtc = ({
  year,
  month,
  day,
  hour,
}: {
  year: number;
  month: number;
  day: number;
  hour: number;
}): Date => {
  const target = Date.UTC(year, month - 1, day, hour);
  let candidate = target;

  for (let attempt = 0; attempt < 3; attempt++) {
    const local = partsAt(new Date(candidate));
    const represented = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    candidate += target - represented;
  }

  return new Date(candidate);
};

export const nextOsloMidday = (now = new Date()): Date => {
  const local = partsAt(now);
  const localDate = new Date(
    Date.UTC(
      local.year,
      local.month - 1,
      local.day + (local.hour >= 12 ? 1 : 0),
    ),
  );

  return localTimeToUtc({
    year: localDate.getUTCFullYear(),
    month: localDate.getUTCMonth() + 1,
    day: localDate.getUTCDate(),
    hour: 12,
  });
};

const wait = async (milliseconds: number, signal: AbortSignal) => {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
};

export const runService = async ({
  log,
  signal,
}: {
  log: Logger;
  signal: AbortSignal;
}): Promise<void> => {
  let planetCheckDue = new Date(0);

  while (!signal.aborted) {
    try {
      if (Date.now() >= planetCheckDue.getTime()) {
        await ensureLatestPlanet(log, signal);
        planetCheckDue = nextOsloMidday();
        log.info(
          { nextPlanetCheckAt: planetCheckDue },
          "Scheduled next planet check",
        );
      }

      await syncMinuteChanges(log, signal);
      const waitMs = Math.max(
        1_000,
        Math.min(
          runtimeEnv.OSM_REPLICATION_POLL_INTERVAL_MS,
          planetCheckDue.getTime() - Date.now(),
        ),
      );
      await wait(waitMs, signal);
    } catch (error) {
      if (signal.aborted) break;
      log.error(
        { err: error, retryDelayMs: runtimeEnv.OSM_RETRY_DELAY_MS },
        "OSM ingestion cycle failed; retrying",
      );
      await wait(runtimeEnv.OSM_RETRY_DELAY_MS, signal);
    }
  }
};
