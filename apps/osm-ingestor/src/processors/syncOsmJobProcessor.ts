import { stat } from "node:fs/promises";
import type { Job } from "bullmq";
import {
  type OsmPlanetRemoteMetadata,
  osmPlanetClient,
} from "../clients/osmPlanetClient.ts";
import { osmReplicationClient } from "../clients/osmReplicationClient.ts";
import { runtimeEnv } from "../config.ts";
import {
  getOsmPlanetImportState,
  getOsmReplicationState,
  markMissingOsmAedsDeleted,
  markOsmAedsDeleted,
  type OsmPlanetImportState,
  type OsmReplicationState,
  osmMinuteReplicationSource,
  saveOsmPlanetImportState,
  saveOsmReplicationState,
  upsertOsmAeds,
} from "../repositories/osmAedRepository.ts";
import {
  hasAedTags,
  isNorwegianAedNode,
  type OsmAedKey,
  type OsmAedRow,
  type OsmNodeLike,
  transformOsmNodeAedForStorage,
} from "../utils/osmAed.ts";
import {
  type OsmNodeChange,
  parseOsmChangeBuffer,
} from "../utils/osmChangeParser.ts";
import {
  buildDownloadedPlanetPath,
  pruneOldPlanetFiles,
  resolveOsmPlanetPath,
} from "../utils/osmPlanetFiles.ts";
import { parseOsmPlanetFile } from "../utils/osmPlanetParser.ts";

interface PreparedOsmNodeChanges {
  aeds: OsmAedRow[];
  deleteKeys: OsmAedKey[];
  nodeChanges: number;
  norwegianAeds: number;
  outsideNorwayAeds: number;
  skippedMissingCoordinates: number;
}

const keyString = (key: OsmAedKey): string =>
  `${key.element_type}/${key.element_id}`;

const nodeKey = (id: number): OsmAedKey => ({
  element_type: "node",
  element_id: id,
});

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
};

const timestamp = (date: Date | null): number | null =>
  date ? date.getTime() : null;

const isSameRemoteBuild = ({
  current,
  previous,
}: {
  current: OsmPlanetRemoteMetadata;
  previous: OsmPlanetImportState | null;
}): boolean => {
  if (!previous) return false;

  if (current.etag || previous.remote_etag) {
    return current.etag === previous.remote_etag;
  }

  if (current.lastModified || previous.remote_last_modified) {
    return (
      timestamp(current.lastModified) ===
      timestamp(previous.remote_last_modified)
    );
  }

  if (
    current.contentLength !== null ||
    previous.remote_content_length !== null
  ) {
    return current.contentLength === previous.remote_content_length;
  }

  return true;
};

const describeRemoteBuild = (metadata: OsmPlanetRemoteMetadata): string =>
  [
    `url=${metadata.sourceUrl}`,
    metadata.etag ? `etag=${metadata.etag}` : null,
    metadata.lastModified
      ? `lastModified=${metadata.lastModified.toISOString()}`
      : null,
    metadata.contentLength !== null
      ? `contentLength=${metadata.contentLength}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

const changeToNode = (change: OsmNodeChange): OsmNodeLike | null => {
  if (change.lat === null || change.lon === null) return null;

  return {
    type: "node",
    id: change.id,
    lat: change.lat,
    lon: change.lon,
    tags: change.tags,
    info: change.info,
  };
};

const prepareOsmNodeChanges = (
  changes: OsmNodeChange[],
): PreparedOsmNodeChanges => {
  const upserts = new Map<string, OsmAedRow>();
  const deletes = new Map<string, OsmAedKey>();
  let norwegianAeds = 0;
  let outsideNorwayAeds = 0;
  let skippedMissingCoordinates = 0;

  for (const change of changes) {
    const key = nodeKey(change.id);
    const mapKey = keyString(key);

    if (change.action === "delete") {
      deletes.set(mapKey, key);
      upserts.delete(mapKey);
      continue;
    }

    const node = changeToNode(change);
    if (!node) {
      if (hasAedTags(change.tags)) skippedMissingCoordinates++;
      deletes.set(mapKey, key);
      upserts.delete(mapKey);
      continue;
    }

    if (isNorwegianAedNode(node)) {
      norwegianAeds++;
      upserts.set(mapKey, transformOsmNodeAedForStorage(node));
      deletes.delete(mapKey);
      continue;
    }

    if (hasAedTags(node.tags)) outsideNorwayAeds++;
    deletes.set(mapKey, key);
    upserts.delete(mapKey);
  }

  return {
    aeds: [...upserts.values()],
    deleteKeys: [...deletes.values()],
    nodeChanges: changes.length,
    norwegianAeds,
    outsideNorwayAeds,
    skippedMissingCoordinates,
  };
};

const applyMinutePatch = async ({
  baseUrl,
  sequenceNumber,
}: {
  baseUrl: string;
  sequenceNumber: number;
}): Promise<OsmReplicationState> => {
  const buffer = await osmReplicationClient.getChangeFile({
    baseUrl,
    sequenceNumber,
  });
  const changes = parseOsmChangeBuffer(buffer);
  const prepared = prepareOsmNodeChanges(changes);

  const { upserted } =
    prepared.aeds.length > 0
      ? await upsertOsmAeds(prepared.aeds)
      : { upserted: 0 };
  const { deleted } =
    prepared.deleteKeys.length > 0
      ? await markOsmAedsDeleted(prepared.deleteKeys)
      : { deleted: 0 };

  const nextState = await osmReplicationClient.getStateForSequence({
    baseUrl,
    sequenceNumber,
  });
  await saveOsmReplicationState(nextState);

  console.log(
    [
      `Applied OSM minute patch ${sequenceNumber}.`,
      `Node changes: ${prepared.nodeChanges}.`,
      `Upserted: ${upserted}.`,
      `Deleted: ${deleted}.`,
      `Norwegian AED changes: ${prepared.norwegianAeds}.`,
      `Outside Norway AED changes: ${prepared.outsideNorwayAeds}.`,
      `Skipped missing coordinates: ${prepared.skippedMissingCoordinates}.`,
    ].join(" "),
  );

  return nextState;
};

const importPlanetFile = async ({
  metadata,
}: {
  metadata: OsmPlanetRemoteMetadata;
}) => {
  const latestPath = resolveOsmPlanetPath(runtimeEnv.OSM_PLANET_FILE_PATH);
  const downloadedPath = buildDownloadedPlanetPath({
    latestPath,
    remoteLastModified: metadata.lastModified,
  });

  if (await fileExists(downloadedPath)) {
    console.log(`Using existing OSM planet file at ${downloadedPath}`);
  } else {
    console.log(
      `Downloading OSM planet file from ${metadata.sourceUrl} to ${downloadedPath}`,
    );
    await osmPlanetClient.downloadFile({
      sourceUrl: metadata.sourceUrl,
      targetPath: downloadedPath,
    });
  }

  console.log(`Starting full OSM planet import from ${downloadedPath}`);

  let upsertedTotal = 0;
  const result = await parseOsmPlanetFile({
    filePath: downloadedPath,
    replicationBaseUrl: runtimeEnv.OSM_REPLICATION_BASE_URL,
    batchSize: runtimeEnv.OSM_PLANET_BATCH_SIZE,
    onBatch: async (aeds) => {
      const { upserted } = await upsertOsmAeds(aeds);
      upsertedTotal += upserted;
    },
  });

  if (!result.replicationState) {
    throw new Error(
      `OSM planet file ${downloadedPath} did not include replication state metadata.`,
    );
  }

  if (result.norwegianAeds === 0) {
    throw new Error(
      `OSM planet file ${downloadedPath} did not contain any Norwegian AEDs. Refusing to mark existing rows deleted.`,
    );
  }

  const { deleted } = await markMissingOsmAedsDeleted(result.foundKeys);
  await saveOsmReplicationState({
    ...result.replicationState,
    source: osmMinuteReplicationSource,
  });
  await saveOsmPlanetImportState({
    source_url: metadata.sourceUrl,
    file_path: downloadedPath,
    remote_etag: metadata.etag,
    remote_last_modified: metadata.lastModified,
    remote_content_length: metadata.contentLength,
    imported_at: new Date(),
  });
  await pruneOldPlanetFiles({
    latestPath,
    retainDownloads: runtimeEnv.OSM_PLANET_RETAIN_DOWNLOADS,
  });

  console.log(
    [
      "Finished full OSM planet import.",
      `Norwegian AEDs: ${result.norwegianAeds}.`,
      `Outside Norway AEDs: ${result.outsideNorwayAeds}.`,
      `Scanned nodes: ${result.scannedNodes}.`,
      `Skipped non-node AED elements: ${result.skippedNonNodeAeds}.`,
      `Upserted: ${upsertedTotal}.`,
      `Deleted missing: ${deleted}.`,
      `Replication sequence: ${result.replicationState.sequence_number}.`,
    ].join(" "),
  );
};

const syncMinutePatches = async (storedState: OsmReplicationState) => {
  const currentState = await osmReplicationClient.getCurrentState(
    storedState.base_url,
  );

  if (storedState.sequence_number >= currentState.sequence_number) {
    console.log(
      `OSM replication is up to date at sequence ${storedState.sequence_number}.`,
    );
    return;
  }

  const maxSequence = Math.min(
    currentState.sequence_number,
    storedState.sequence_number + runtimeEnv.OSM_MAX_MINUTE_PATCHES_PER_JOB,
  );
  let latestState = storedState;

  for (
    let sequenceNumber = storedState.sequence_number + 1;
    sequenceNumber <= maxSequence;
    sequenceNumber++
  ) {
    latestState = await applyMinutePatch({
      baseUrl: latestState.base_url,
      sequenceNumber,
    });
  }

  console.log(
    `OSM replication advanced from sequence ${storedState.sequence_number} to ${latestState.sequence_number}. Current source sequence is ${currentState.sequence_number}.`,
  );
};

export const syncOsmJobProcessor = async (job: Job) => {
  console.log(`syncOsmJobProcessor received job ${job.id}`);

  const metadata = await osmPlanetClient.getRemoteMetadata(
    runtimeEnv.OSM_PLANET_URL,
  );
  const [planetState, storedState] = await Promise.all([
    getOsmPlanetImportState(metadata.sourceUrl),
    getOsmReplicationState(osmMinuteReplicationSource),
  ]);

  const shouldRunFullImport =
    !storedState ||
    !isSameRemoteBuild({ current: metadata, previous: planetState });

  if (shouldRunFullImport) {
    if (!storedState) {
      console.log(
        "Missing OSM replication state; running a full planet import before minute patches.",
      );
    } else {
      console.log(
        `Detected a new OSM planet build; running a full import instead of minute patches. ${describeRemoteBuild(metadata)}`,
      );
    }

    await importPlanetFile({ metadata });
    return;
  }

  await syncMinutePatches(storedState);
};
