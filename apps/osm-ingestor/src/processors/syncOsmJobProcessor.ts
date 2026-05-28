import { stat } from "node:fs/promises";
import type { Job } from "bullmq";
import type { Logger } from "pino";
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
  log,
}: {
  baseUrl: string;
  sequenceNumber: number;
  log: Logger;
}): Promise<OsmReplicationState> => {
  const patchLog = log.child({ sequenceNumber });
  patchLog.debug({ baseUrl }, "Fetching OSM minute change file");
  const buffer = await osmReplicationClient.getChangeFile({
    baseUrl,
    sequenceNumber,
  });
  patchLog.trace({ bytes: buffer.byteLength }, "Change file downloaded");

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

  if (prepared.skippedMissingCoordinates > 0) {
    patchLog.warn(
      { skippedMissingCoordinates: prepared.skippedMissingCoordinates },
      "Skipped AED changes due to missing coordinates",
    );
  }

  patchLog.info(
    {
      nodeChanges: prepared.nodeChanges,
      upserted,
      deleted,
      norwegianAeds: prepared.norwegianAeds,
      outsideNorwayAeds: prepared.outsideNorwayAeds,
      skippedMissingCoordinates: prepared.skippedMissingCoordinates,
    },
    "Applied OSM minute patch",
  );

  return nextState;
};

const importPlanetFile = async ({
  metadata,
  log,
}: {
  metadata: OsmPlanetRemoteMetadata;
  log: Logger;
}) => {
  const latestPath = resolveOsmPlanetPath(runtimeEnv.OSM_PLANET_FILE_PATH);
  const downloadedPath = buildDownloadedPlanetPath({
    latestPath,
    remoteLastModified: metadata.lastModified,
  });
  const importLog = log.child({ planetPath: downloadedPath });

  if (await fileExists(downloadedPath)) {
    importLog.info("Using cached OSM planet file");
  } else {
    importLog.info(
      {
        sourceUrl: metadata.sourceUrl,
        contentLength: metadata.contentLength,
        remoteLastModified: metadata.lastModified,
        etag: metadata.etag,
      },
      "Downloading OSM planet file",
    );
    await osmPlanetClient.downloadFile({
      sourceUrl: metadata.sourceUrl,
      targetPath: downloadedPath,
    });
    importLog.info("OSM planet file download complete");
  }

  importLog.info(
    { batchSize: runtimeEnv.OSM_PLANET_BATCH_SIZE },
    "Starting full OSM planet import",
  );

  let upsertedTotal = 0;
  const result = await parseOsmPlanetFile({
    filePath: downloadedPath,
    replicationBaseUrl: runtimeEnv.OSM_REPLICATION_BASE_URL,
    batchSize: runtimeEnv.OSM_PLANET_BATCH_SIZE,
    logger: importLog,
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
    logger: importLog,
  });

  importLog.info(
    {
      norwegianAeds: result.norwegianAeds,
      outsideNorwayAeds: result.outsideNorwayAeds,
      scannedNodes: result.scannedNodes,
      skippedNonNodeAeds: result.skippedNonNodeAeds,
      upserted: upsertedTotal,
      deletedMissing: deleted,
      replicationSequence: result.replicationState.sequence_number,
    },
    "Finished full OSM planet import",
  );
};

const syncMinutePatches = async (
  storedState: OsmReplicationState,
  log: Logger,
) => {
  const currentState = await osmReplicationClient.getCurrentState(
    storedState.base_url,
  );

  if (storedState.sequence_number >= currentState.sequence_number) {
    log.debug(
      { sequenceNumber: storedState.sequence_number },
      "OSM replication is up to date",
    );
    return;
  }

  const maxSequence = Math.min(
    currentState.sequence_number,
    storedState.sequence_number + runtimeEnv.OSM_MAX_MINUTE_PATCHES_PER_JOB,
  );
  const totalPatches = maxSequence - storedState.sequence_number;
  log.info(
    {
      fromSequence: storedState.sequence_number,
      toSequence: maxSequence,
      currentSourceSequence: currentState.sequence_number,
      patches: totalPatches,
    },
    "Applying OSM minute patches",
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
      log,
    });
  }

  log.info(
    {
      fromSequence: storedState.sequence_number,
      toSequence: latestState.sequence_number,
      currentSourceSequence: currentState.sequence_number,
      lagBehind: currentState.sequence_number - latestState.sequence_number,
    },
    "OSM replication advanced",
  );
};

export const syncOsmJobProcessor = async (_job: Job, log: Logger) => {
  log.info("Starting OSM sync");

  const metadata = await osmPlanetClient.getRemoteMetadata(
    runtimeEnv.OSM_PLANET_URL,
  );
  log.debug(
    {
      sourceUrl: metadata.sourceUrl,
      etag: metadata.etag,
      lastModified: metadata.lastModified,
      contentLength: metadata.contentLength,
    },
    "Fetched OSM planet remote metadata",
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
      log.info(
        "Missing OSM replication state; running a full planet import before minute patches",
      );
    } else {
      log.info(
        {
          previousEtag: planetState?.remote_etag ?? null,
          previousLastModified: planetState?.remote_last_modified ?? null,
          previousContentLength: planetState?.remote_content_length ?? null,
          currentEtag: metadata.etag,
          currentLastModified: metadata.lastModified,
          currentContentLength: metadata.contentLength,
        },
        "Detected a new OSM planet build; running a full import instead of minute patches",
      );
    }

    await importPlanetFile({ metadata, log });
    return;
  }

  await syncMinutePatches(storedState, log);
};
