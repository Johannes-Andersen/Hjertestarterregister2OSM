import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { clearLine, cursorTo } from "node:readline";
import { OSMTransform } from "osm-pbf-parser-node";
import type { Logger } from "pino";
import type { OsmReplicationState } from "../repositories/osmAedRepository.ts";
import { logger as rootLogger } from "./logger.ts";
import {
  hasAedTags,
  isNorwegianAedNode,
  type OsmAedKey,
  type OsmAedRow,
  type OsmElementInfo,
  type OsmNodeLike,
  toOsmAedKey,
  transformOsmNodeAedForStorage,
} from "./osmAed.ts";

interface ParseOsmPlanetFileOptions {
  filePath: string;
  replicationBaseUrl: string;
  batchSize: number;
  onBatch: (aeds: OsmAedRow[]) => Promise<void>;
  logger?: Logger;
  signal?: AbortSignal;
}

export interface ParseOsmPlanetFileResult {
  foundKeys: OsmAedKey[];
  norwegianAeds: number;
  outsideNorwayAeds: number;
  scannedNodes: number;
  skippedNonNodeAeds: number;
  replicationState: OsmReplicationState | null;
}

interface OsmPbfHeader {
  osmosis_replication_sequence_number?: number;
  osmosis_replication_timestamp?: number;
  osmosis_replication_base_url?: string;
}

interface ProgressSnapshot {
  bytesRead: number;
  totalBytes: number;
  scannedNodes: number;
  norwegianAeds: number;
  outsideNorwayAeds: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const formatBytes = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return "--";

  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
};

const buildProgressLine = ({
  bytesRead,
  totalBytes,
  scannedNodes,
  norwegianAeds,
  outsideNorwayAeds,
  startedAt,
}: ProgressSnapshot & { startedAt: number }): string => {
  const percent = totalBytes > 0 ? Math.min(bytesRead / totalBytes, 1) : 0;
  const barWidth = 28;
  const completed = Math.round(percent * barWidth);
  const bar = `${"#".repeat(completed)}${"-".repeat(barWidth - completed)}`;
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
  const bytesPerSecond = bytesRead / elapsedSeconds;
  const etaSeconds =
    bytesPerSecond > 0 ? (totalBytes - bytesRead) / bytesPerSecond : Number.NaN;

  return [
    `Parsing OSM planet [${bar}] ${(percent * 100).toFixed(1)}%`,
    `${formatBytes(bytesRead)}/${formatBytes(totalBytes)}`,
    `${formatBytes(bytesPerSecond)}/s`,
    `ETA ${formatDuration(etaSeconds)}`,
    `nodes ${scannedNodes.toLocaleString("en")}`,
    `NO AEDs ${norwegianAeds.toLocaleString("en")}`,
    `outside NO ${outsideNorwayAeds.toLocaleString("en")}`,
  ].join(" | ");
};

const createProgressReporter = (totalBytes: number, log: Logger) => {
  const isTty = Boolean(process.stderr.isTTY);
  const startedAt = Date.now();
  let lastRenderAt = 0;
  let lastLoggedPercent = -5;
  let hasRendered = false;

  const writeTtyLine = (line: string) => {
    clearLine(process.stderr, 0);
    cursorTo(process.stderr, 0);
    process.stderr.write(line);
    hasRendered = true;
  };

  const render = (snapshot: ProgressSnapshot, force = false) => {
    const now = Date.now();
    const percent =
      snapshot.totalBytes > 0
        ? Math.floor((snapshot.bytesRead / snapshot.totalBytes) * 100)
        : 0;

    if (!force) {
      if (isTty && now - lastRenderAt < 1000) return;
      if (!isTty && percent < lastLoggedPercent + 5) return;
    }

    lastRenderAt = now;
    lastLoggedPercent = percent;

    if (isTty) {
      writeTtyLine(buildProgressLine({ ...snapshot, startedAt }));
      return;
    }

    const elapsedSeconds = Math.max((now - startedAt) / 1000, 0.001);
    log.info(
      {
        percent,
        bytesRead: snapshot.bytesRead,
        totalBytes: snapshot.totalBytes,
        bytesPerSecond: Math.round(snapshot.bytesRead / elapsedSeconds),
        scannedNodes: snapshot.scannedNodes,
        norwegianAeds: snapshot.norwegianAeds,
        outsideNorwayAeds: snapshot.outsideNorwayAeds,
      },
      "Parsing OSM planet progress",
    );
  };

  const finish = (snapshot: ProgressSnapshot) => {
    render(snapshot, true);
    if (isTty && hasRendered) process.stderr.write("\n");
  };

  return {
    finish,
    render,
    totalBytes,
  };
};

const getTags = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value) || !isRecord(value.tags)) return undefined;

  const tags: Record<string, string> = {};
  for (const [key, tagValue] of Object.entries(value.tags)) {
    if (typeof tagValue === "string") tags[key] = tagValue;
  }

  return tags;
};

const getInfo = (value: unknown): OsmElementInfo | undefined => {
  if (!isRecord(value) || !isRecord(value.info)) return undefined;

  const info: OsmElementInfo = {};
  if (typeof value.info.version === "number") info.version = value.info.version;
  if (typeof value.info.changeset === "number") {
    info.changeset = value.info.changeset;
  }
  if (typeof value.info.uid === "number") info.uid = value.info.uid;
  if (typeof value.info.user === "string") info.user = value.info.user;
  if (
    typeof value.info.timestamp === "number" ||
    typeof value.info.timestamp === "string"
  ) {
    info.timestamp = value.info.timestamp;
  }

  return info;
};

const toNode = (value: unknown): OsmNodeLike | null => {
  if (!isRecord(value)) return null;
  if (value.type !== "node") return null;
  if (typeof value.id !== "number") return null;
  if (typeof value.lat !== "number") return null;
  if (typeof value.lon !== "number") return null;

  return {
    type: "node",
    id: value.id,
    lat: value.lat,
    lon: value.lon,
    tags: getTags(value),
    info: getInfo(value),
  };
};

const toHeaderReplicationState = ({
  header,
  replicationBaseUrl,
}: {
  header: OsmPbfHeader;
  replicationBaseUrl: string;
}): OsmReplicationState | null => {
  const sequenceNumber = header.osmosis_replication_sequence_number;
  const timestamp = header.osmosis_replication_timestamp;

  if (
    typeof sequenceNumber !== "number" ||
    !Number.isInteger(sequenceNumber) ||
    typeof timestamp !== "number"
  ) {
    return null;
  }

  return {
    source: "minute",
    sequence_number: sequenceNumber,
    timestamp: new Date(timestamp * 1000),
    base_url: replicationBaseUrl,
  };
};

export const parseOsmPlanetFile = async ({
  filePath,
  replicationBaseUrl,
  batchSize,
  onBatch,
  logger = rootLogger.child({ module: "osmPlanetParser" }),
  signal,
}: ParseOsmPlanetFileOptions): Promise<ParseOsmPlanetFileResult> => {
  const foundKeys: OsmAedKey[] = [];
  let norwegianAeds = 0;
  let outsideNorwayAeds = 0;
  let scannedNodes = 0;
  let skippedNonNodeAeds = 0;
  let replicationState: OsmReplicationState | null = null;
  let batch: OsmAedRow[] = [];
  let bytesRead = 0;
  const fileStat = await stat(filePath);
  const progress = createProgressReporter(fileStat.size, logger);

  const getProgressSnapshot = (): ProgressSnapshot => ({
    bytesRead,
    totalBytes: progress.totalBytes,
    scannedNodes,
    norwegianAeds,
    outsideNorwayAeds,
  });

  const flush = async () => {
    if (batch.length === 0) return;
    const nextBatch = batch;
    batch = [];
    await onBatch(nextBatch);
  };

  const sourceStream = createReadStream(filePath);
  const osmStream = sourceStream.pipe(
    new OSMTransform({
      withInfo: true,
      withTags: {
        node: true,
        relation: ["emergency"],
        way: ["emergency"],
      },
    }),
  );

  const onAbort = () => {
    const abortError = new Error("OSM planet parse aborted");
    sourceStream.destroy(abortError);
    osmStream.destroy(abortError);
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  sourceStream.on("error", (err) => {
    logger.error({ err, filePath }, "Error reading OSM planet file stream");
    osmStream.destroy(err);
  });

  sourceStream.on("data", (chunk) => {
    bytesRead += Buffer.isBuffer(chunk)
      ? chunk.byteLength
      : Buffer.byteLength(chunk);
    progress.render(getProgressSnapshot());
  });

  try {
    for await (const chunk of osmStream) {
      if (signal?.aborted) {
        throw new Error("OSM planet parse aborted");
      }
      if (!Array.isArray(chunk)) continue;

      for (const item of chunk) {
        if (isRecord(item) && item.type === undefined) {
          replicationState = toHeaderReplicationState({
            header: item,
            replicationBaseUrl,
          });
          continue;
        }

        const node = toNode(item);
        if (!node) {
          // The existing reconciliation flow only supports AED nodes. Keep this
          // visible in metrics while the OSM ingestor replaces the Overpass path.
          if (hasAedTags(getTags(item))) skippedNonNodeAeds++;
          continue;
        }

        scannedNodes++;
        if (!hasAedTags(node.tags)) continue;

        if (!isNorwegianAedNode(node)) {
          outsideNorwayAeds++;
          continue;
        }

        norwegianAeds++;
        foundKeys.push(toOsmAedKey(node));
        batch.push(transformOsmNodeAedForStorage(node));

        if (batch.length >= batchSize) await flush();
      }
    }

    await flush();
    bytesRead = fileStat.size;
    progress.finish(getProgressSnapshot());
  } catch (error) {
    progress.finish(getProgressSnapshot());
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  return {
    foundKeys,
    norwegianAeds,
    outsideNorwayAeds,
    scannedNodes,
    skippedNonNodeAeds,
    replicationState,
  };
};
