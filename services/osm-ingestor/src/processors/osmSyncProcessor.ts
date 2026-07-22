import { stat } from "node:fs/promises";
import type { Logger } from "pino";
import {
  type OsmPlanetRemoteMetadata,
  osmPlanetClient,
} from "../clients/osmPlanetClient.ts";
import { osmReplicationClient } from "../clients/osmReplicationClient.ts";
import { runtimeEnv } from "../config.ts";
import { nodeExtensions } from "../extensions/index.ts";
import {
  getOsmPlanetImportState,
  getOsmReplicationState,
  type OsmPlanetImportState,
  type OsmReplicationState,
  osmMinuteReplicationSource,
  saveOsmPlanetImportState,
  saveOsmReplicationState,
} from "../repositories/osmStateRepository.ts";
import { parseOsmChangeBuffer } from "../utils/osmChangeParser.ts";
import {
  buildDownloadedPlanetPath,
  pruneOldPlanetFiles,
  resolveOsmPlanetPath,
} from "../utils/osmPlanetFiles.ts";
import { parseOsmPlanetFile } from "../utils/osmPlanetParser.ts";

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

const applyMinutePatch = async ({
  baseUrl,
  sequenceNumber,
  log,
  signal,
}: {
  baseUrl: string;
  sequenceNumber: number;
  log: Logger;
  signal?: AbortSignal;
}): Promise<OsmReplicationState> => {
  const patchLog = log.child({ sequenceNumber });
  patchLog.debug({ baseUrl }, "Fetching OSM minute change file");
  const buffer = await osmReplicationClient.getChangeFile({
    baseUrl,
    sequenceNumber,
    signal,
  });
  patchLog.trace({ bytes: buffer.byteLength }, "Change file downloaded");

  const changes = parseOsmChangeBuffer(buffer);

  if (signal?.aborted)
    throw new Error(`OSM minute patch ${sequenceNumber} cancelled`);

  const extensionResults = await Promise.all(
    nodeExtensions.map((extension) =>
      extension.applyMinuteChanges(changes, sequenceNumber),
    ),
  );

  const nextState = await osmReplicationClient.getStateForSequence({
    baseUrl,
    sequenceNumber,
    signal,
  });
  await saveOsmReplicationState(nextState);

  patchLog.info(
    {
      nodeChanges: changes.length,
      extensions: extensionResults,
    },
    "Applied OSM minute patch",
  );

  return nextState;
};

const importPlanetFile = async ({
  metadata,
  log,
  signal,
}: {
  metadata: OsmPlanetRemoteMetadata;
  log: Logger;
  signal?: AbortSignal;
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
      signal,
    });
    importLog.info("OSM planet file download complete");
  }

  if (signal?.aborted)
    throw new Error("OSM planet import cancelled before parsing");

  importLog.info(
    { batchSize: runtimeEnv.OSM_PLANET_BATCH_SIZE },
    "Starting full OSM planet import",
  );

  const result = await parseOsmPlanetFile({
    filePath: downloadedPath,
    replicationBaseUrl: runtimeEnv.OSM_REPLICATION_BASE_URL,
    batchSize: runtimeEnv.OSM_PLANET_BATCH_SIZE,
    extensions: nodeExtensions,
    logger: importLog,
    signal,
  });

  if (!result.replicationState) {
    throw new Error(
      `OSM planet file ${downloadedPath} did not include replication state metadata.`,
    );
  }

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
      scannedNodes: result.scannedNodes,
      extensions: result.extensionResults,
      replicationSequence: result.replicationState.sequence_number,
    },
    "Finished full OSM planet import",
  );
};

const syncMinutePatches = async (
  storedState: OsmReplicationState,
  log: Logger,
  signal?: AbortSignal,
) => {
  const currentState = await osmReplicationClient.getCurrentState(
    storedState.base_url,
    signal,
  );

  if (storedState.sequence_number >= currentState.sequence_number) {
    log.debug(
      { sequenceNumber: storedState.sequence_number },
      "OSM replication is up to date",
    );
    return;
  }

  const maxSequence = currentState.sequence_number;
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
    if (signal?.aborted) {
      log.warn(
        { sequenceNumber },
        "OSM minute patch loop cancelled before applying patch",
      );
      throw new Error("OSM minute patch loop cancelled");
    }
    latestState = await applyMinutePatch({
      baseUrl: latestState.base_url,
      sequenceNumber,
      log,
      signal,
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

export const ensureLatestPlanet = async (log: Logger, signal?: AbortSignal) => {
  log.info("Checking OSM planet file");

  const metadata = await osmPlanetClient.getRemoteMetadata(
    runtimeEnv.OSM_PLANET_URL,
    signal,
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
  const planetState = await getOsmPlanetImportState(metadata.sourceUrl);
  const hasImportedFile = planetState
    ? await fileExists(planetState.file_path)
    : false;

  const shouldRunFullImport =
    !hasImportedFile ||
    !isSameRemoteBuild({ current: metadata, previous: planetState });

  if (shouldRunFullImport) {
    if (!planetState) {
      log.info("Missing OSM planet import; running the initial import");
    } else if (!hasImportedFile) {
      log.info(
        { filePath: planetState.file_path },
        "Imported planet file is missing from disk; downloading it again",
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

    await importPlanetFile({ metadata, log, signal });
  } else {
    log.info(
      { filePath: planetState?.file_path },
      "OSM planet file is already current",
    );
  }
};

export const syncMinuteChanges = async (log: Logger, signal?: AbortSignal) => {
  const storedState = await getOsmReplicationState(osmMinuteReplicationSource);
  if (!storedState) {
    throw new Error(
      "OSM replication state is missing; a planet import must complete first.",
    );
  }
  await syncMinutePatches(storedState, log, signal);
};
