import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { OSMTransform } from "osm-pbf-parser-node";
import type { Logger } from "pino";
import type { OsmElementInfo, OsmNode, OsmTags } from "./types.ts";

export interface ParsedPlanet {
  scannedNodes: number;
  replicationState: { sequence: number; timestamp: Date } | null;
}

interface PlanetHeader {
  osmosis_replication_sequence_number?: number;
  osmosis_replication_timestamp?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toTags = (value: unknown): OsmTags => {
  const tags: OsmTags = {};
  if (isRecord(value) && isRecord(value.tags)) {
    for (const [key, tagValue] of Object.entries(value.tags)) {
      if (typeof tagValue === "string") tags[key] = tagValue;
    }
  }
  return tags;
};

const toInfo = (value: unknown): OsmElementInfo => {
  const info: OsmElementInfo = {};
  if (!isRecord(value) || !isRecord(value.info)) return info;
  const raw = value.info;
  if (typeof raw.version === "number") info.version = raw.version;
  if (typeof raw.changeset === "number") info.changeset = raw.changeset;
  if (typeof raw.uid === "number") info.uid = raw.uid;
  if (typeof raw.user === "string") info.user = raw.user;
  if (typeof raw.timestamp === "number" || typeof raw.timestamp === "string") {
    info.timestamp = raw.timestamp;
  }
  return info;
};

const toNode = (value: unknown): OsmNode | null => {
  if (!isRecord(value) || value.type !== "node") return null;
  if (
    typeof value.id !== "number" ||
    typeof value.lat !== "number" ||
    typeof value.lon !== "number"
  ) {
    return null;
  }
  return {
    id: value.id,
    lat: value.lat,
    lon: value.lon,
    tags: toTags(value),
    info: toInfo(value),
  };
};

const toReplicationState = (
  header: PlanetHeader,
): { sequence: number; timestamp: Date } | null => {
  const sequence = header.osmosis_replication_sequence_number;
  const timestamp = header.osmosis_replication_timestamp;
  if (
    typeof sequence !== "number" ||
    !Number.isInteger(sequence) ||
    typeof timestamp !== "number"
  ) {
    return null;
  }
  return { sequence, timestamp: new Date(timestamp * 1000) };
};

/**
 * Stream a planet `.pbf` file, invoking `onNode` for every node. Returns the
 * embedded replication state (used to resume minute patching) and node count.
 */
export const parseOsmPlanet = async ({
  filePath,
  onNode,
  logger,
  signal,
}: {
  filePath: string;
  onNode: (node: OsmNode) => void | Promise<void>;
  logger: Logger;
  signal?: AbortSignal;
}): Promise<ParsedPlanet> => {
  const { size: totalBytes } = await stat(filePath);
  let scannedNodes = 0;
  let replicationState: ParsedPlanet["replicationState"] = null;
  let bytesRead = 0;
  let loggedPercent = 0;

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
  sourceStream.on("data", (chunk: Buffer | string) => {
    bytesRead += Buffer.isBuffer(chunk)
      ? chunk.byteLength
      : Buffer.byteLength(chunk);
    const percent = Math.floor((bytesRead / totalBytes) * 100);
    if (percent >= loggedPercent + 10) {
      loggedPercent = percent;
      logger.info({ percent, scannedNodes }, "Parsing OSM planet");
    }
  });

  try {
    for await (const chunk of osmStream) {
      if (signal?.aborted) throw new Error("OSM planet parse aborted");
      if (!Array.isArray(chunk)) continue;
      for (const item of chunk) {
        if (isRecord(item) && item.type === undefined) {
          replicationState = toReplicationState(item);
          continue;
        }
        const node = toNode(item);
        if (!node) continue;
        scannedNodes++;
        await onNode(node);
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  return { scannedNodes, replicationState };
};
