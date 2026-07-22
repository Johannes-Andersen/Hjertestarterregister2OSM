import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { clearLine, cursorTo } from "node:readline";
import { OSMTransform } from "osm-pbf-parser-node";
import type { Logger } from "pino";
import type { ExtensionResult, OsmNodeExtension } from "../extensions/types.ts";
import type { OsmReplicationState } from "../repositories/osmStateRepository.ts";
import type { OsmElementInfo, OsmNodeLike } from "../types/osm.ts";
import { logger as rootLogger } from "./logger.ts";

interface ParseOsmPlanetFileOptions {
  filePath: string;
  replicationBaseUrl: string;
  batchSize: number;
  extensions: OsmNodeExtension[];
  logger?: Logger;
  signal?: AbortSignal;
}

export interface ParseOsmPlanetFileResult {
  scannedNodes: number;
  extensionResults: ExtensionResult[];
  replicationState: OsmReplicationState | null;
}

interface OsmPbfHeader {
  osmosis_replication_sequence_number?: number;
  osmosis_replication_timestamp?: number;
}

interface ProgressSnapshot {
  bytesRead: number;
  totalBytes: number;
  scannedNodes: number;
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
  ].join(" | ");
};

const createProgressReporter = (totalBytes: number, log: Logger) => {
  const isTty = Boolean(process.stderr.isTTY);
  const startedAt = Date.now();
  let lastRenderAt = 0;
  let lastLoggedPercent = -5;
  let hasRendered = false;

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
      clearLine(process.stderr, 0);
      cursorTo(process.stderr, 0);
      process.stderr.write(buildProgressLine({ ...snapshot, startedAt }));
      hasRendered = true;
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
      },
      "Parsing OSM planet progress",
    );
  };

  return {
    totalBytes,
    render,
    finish(snapshot: ProgressSnapshot) {
      render(snapshot, true);
      if (isTty && hasRendered) process.stderr.write("\n");
    },
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
  if (!isRecord(value) || value.type !== "node") return null;
  if (
    typeof value.id !== "number" ||
    typeof value.lat !== "number" ||
    typeof value.lon !== "number"
  ) {
    return null;
  }
  return {
    type: "node",
    id: value.id,
    lat: value.lat,
    lon: value.lon,
    tags: getTags(value),
    info: getInfo(value),
  };
};

const toHeaderReplicationState = (
  header: OsmPbfHeader,
  replicationBaseUrl: string,
): OsmReplicationState | null => {
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
  extensions,
  logger = rootLogger.child({ module: "osmPlanetParser" }),
  signal,
}: ParseOsmPlanetFileOptions): Promise<ParseOsmPlanetFileResult> => {
  const sessions = extensions.map((extension) =>
    extension.createPlanetImportSession(batchSize),
  );
  let scannedNodes = 0;
  let replicationState: OsmReplicationState | null = null;
  let bytesRead = 0;
  const fileStat = await stat(filePath);
  const progress = createProgressReporter(fileStat.size, logger);
  const snapshot = (): ProgressSnapshot => ({
    bytesRead,
    totalBytes: progress.totalBytes,
    scannedNodes,
  });

  const sourceStream = createReadStream(filePath);
  const osmStream = sourceStream.pipe(
    new OSMTransform({ withInfo: true, withTags: { node: true } }),
  );
  const onAbort = () => {
    const error = new Error("OSM planet parse aborted");
    sourceStream.destroy(error);
    osmStream.destroy(error);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  sourceStream.on("error", (error) => osmStream.destroy(error));
  sourceStream.on("data", (chunk) => {
    bytesRead += Buffer.isBuffer(chunk)
      ? chunk.byteLength
      : Buffer.byteLength(chunk);
    progress.render(snapshot());
  });

  try {
    for await (const chunk of osmStream) {
      if (signal?.aborted) throw new Error("OSM planet parse aborted");
      if (!Array.isArray(chunk)) continue;

      for (const item of chunk) {
        if (isRecord(item) && item.type === undefined) {
          replicationState = toHeaderReplicationState(item, replicationBaseUrl);
          continue;
        }
        const node = toNode(item);
        if (!node) continue;
        scannedNodes++;
        for (const session of sessions) {
          const pending = session.accept(node);
          if (pending) await pending;
        }
      }
    }
    bytesRead = fileStat.size;
    progress.finish(snapshot());
  } catch (error) {
    progress.finish(snapshot());
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  if (!replicationState) {
    return { scannedNodes, extensionResults: [], replicationState: null };
  }
  const extensionResults = await Promise.all(
    sessions.map((session) => session.finish(replicationState)),
  );
  return { scannedNodes, extensionResults, replicationState };
};
