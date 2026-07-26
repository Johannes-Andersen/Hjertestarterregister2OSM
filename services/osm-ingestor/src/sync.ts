import type { Logger } from "pino";
import { env } from "./config.ts";
import type { OsmSyncStateRow } from "./db/schema.ts";
import { handlers } from "./handlers/index.ts";
import {
  buildDownloadPath,
  downloadPlanet,
  fileExists,
  getPlanetMetadata,
  type PlanetMetadata,
  pruneOldPlanets,
  resolvePlanetPath,
} from "./osm/planetClient.ts";
import { parseOsmPlanet } from "./osm/planetParser.ts";
import {
  getChangeFile,
  getRemoteState,
  getStateForSequence,
  parseChangeFile,
} from "./osm/replication.ts";
import type { OsmNode, OsmNodeChange } from "./osm/types.ts";
import {
  getSyncState,
  savePlanetImport,
  saveReplicationState,
} from "./state.ts";

const timestamp = (date: Date | null): number | null => date?.getTime() ?? null;

/** Whether the remote planet build matches the one we last imported. */
const isSameBuild = (
  metadata: PlanetMetadata,
  state: OsmSyncStateRow,
): boolean => {
  if (metadata.etag || state.planetEtag) {
    return metadata.etag === state.planetEtag;
  }
  if (metadata.lastModified || state.planetLastModified) {
    return (
      timestamp(metadata.lastModified) === timestamp(state.planetLastModified)
    );
  }
  if (metadata.contentLength !== null || state.planetContentLength !== null) {
    return metadata.contentLength === state.planetContentLength;
  }
  return true;
};

const importPlanet = async (
  metadata: PlanetMetadata,
  log: Logger,
  signal?: AbortSignal,
): Promise<void> => {
  const latestPath = resolvePlanetPath(env.OSM_PLANET_FILE_PATH);
  const filePath = buildDownloadPath({
    latestPath,
    lastModified: metadata.lastModified,
  });

  if (await fileExists(filePath)) {
    log.info({ filePath }, "Using cached OSM planet file");
  } else {
    log.info({ sourceUrl: metadata.sourceUrl }, "Downloading OSM planet file");
    await downloadPlanet({
      sourceUrl: metadata.sourceUrl,
      targetPath: filePath,
      signal,
    });
  }

  const buffers = handlers.map((handler) => ({
    handler,
    batch: [] as OsmNode[],
    seen: [] as number[],
    upserted: 0,
  }));

  log.info(
    { filePath, batchSize: env.OSM_PLANET_BATCH_SIZE },
    "Starting planet import",
  );
  const { scannedNodes, replicationState } = await parseOsmPlanet({
    filePath,
    logger: log,
    signal,
    onNode: async (node) => {
      for (const buffer of buffers) {
        if (!buffer.handler.matches(node.tags)) continue;
        buffer.seen.push(node.id);
        buffer.batch.push(node);
        if (buffer.batch.length >= env.OSM_PLANET_BATCH_SIZE) {
          buffer.upserted += await buffer.handler.upsert(
            buffer.batch,
            "planet",
          );
          buffer.batch = [];
        }
      }
    },
  });

  if (!replicationState) {
    throw new Error(`OSM planet file ${filePath} has no replication metadata.`);
  }

  const metrics = [];
  for (const buffer of buffers) {
    if (buffer.batch.length > 0) {
      buffer.upserted += await buffer.handler.upsert(buffer.batch, "planet");
    }
    const deleted = await buffer.handler.reconcile(
      buffer.seen,
      replicationState.timestamp,
    );
    metrics.push({
      handler: buffer.handler.id,
      matched: buffer.seen.length,
      upserted: buffer.upserted,
      deleted,
    });
  }

  await saveReplicationState({
    ...replicationState,
    baseUrl: env.OSM_REPLICATION_BASE_URL,
  });
  await savePlanetImport({
    sourceUrl: metadata.sourceUrl,
    filePath,
    etag: metadata.etag,
    lastModified: metadata.lastModified,
    contentLength: metadata.contentLength,
    importedAt: new Date(),
  });
  await pruneOldPlanets({
    latestPath,
    retain: env.OSM_PLANET_RETAIN_DOWNLOADS,
    logger: log,
  });

  log.info(
    { scannedNodes, metrics, sequence: replicationState.sequence },
    "Finished OSM planet import",
  );
};

export const ensureLatestPlanet = async (
  log: Logger,
  signal?: AbortSignal,
): Promise<void> => {
  const metadata = await getPlanetMetadata(env.OSM_PLANET_URL, signal);
  const state = await getSyncState();
  const hasFile = state?.planetFilePath
    ? await fileExists(state.planetFilePath)
    : false;

  if (state && hasFile && isSameBuild(metadata, state)) {
    log.info({ filePath: state.planetFilePath }, "OSM planet file is current");
    return;
  }

  log.info("Importing OSM planet file");
  await importPlanet(metadata, log, signal);
};

const changeToNode = (change: OsmNodeChange): OsmNode | null => {
  if (change.lat === null || change.lon === null) return null;
  return {
    id: change.id,
    lat: change.lat,
    lon: change.lon,
    tags: change.tags,
    info: change.info,
  };
};

const applyMinutePatch = async (
  baseUrl: string,
  sequence: number,
  log: Logger,
  signal?: AbortSignal,
): Promise<void> => {
  const changes = parseChangeFile(
    await getChangeFile(baseUrl, sequence, signal),
  );
  if (signal?.aborted) throw new Error("OSM minute sync cancelled");

  const metrics = [];
  for (const handler of handlers) {
    const upserts: OsmNode[] = [];
    const deletions: OsmNodeChange[] = [];
    for (const change of changes) {
      const node = change.action === "delete" ? null : changeToNode(change);
      if (node && handler.matches(change.tags)) upserts.push(node);
      else deletions.push(change);
    }
    const upserted = await handler.upsert(upserts, "minute", sequence);
    const deleted = await handler.markDeleted(deletions, "minute", sequence);
    metrics.push({ handler: handler.id, upserted, deleted });
  }

  const nextState = await getStateForSequence(baseUrl, sequence, signal);
  await saveReplicationState({ ...nextState, baseUrl });
  log.info(
    { sequence, changes: changes.length, metrics },
    "Applied OSM minute patch",
  );
};

export const syncMinutePatches = async (
  log: Logger,
  signal?: AbortSignal,
): Promise<void> => {
  const state = await getSyncState();
  if (
    !state ||
    state.replicationSequence === null ||
    state.replicationBaseUrl === null
  ) {
    throw new Error(
      "OSM replication state is missing; a planet import must complete first.",
    );
  }

  const baseUrl = state.replicationBaseUrl;
  const remote = await getRemoteState(baseUrl, signal);
  if (state.replicationSequence >= remote.sequence) {
    log.debug(
      { sequence: state.replicationSequence },
      "OSM replication up to date",
    );
    return;
  }

  log.info(
    { from: state.replicationSequence, to: remote.sequence },
    "Applying OSM minute patches",
  );
  let current = state.replicationSequence;
  for (let sequence = current + 1; sequence <= remote.sequence; sequence++) {
    if (signal?.aborted) throw new Error("OSM minute sync cancelled");
    await applyMinutePatch(baseUrl, sequence, log, signal);
    current = sequence;
  }
  log.info(
    {
      from: state.replicationSequence,
      to: current,
      lag: remote.sequence - current,
    },
    "OSM replication advanced",
  );
};

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });

const nextPlanetCheck = (hour: number): Date => {
  const next = new Date();
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  return next;
};

/** Long-running loop: daily planet check + continuous minute patching. */
export const runIngestor = async (
  signal: AbortSignal,
  log: Logger,
): Promise<void> => {
  let planetDueAt = new Date(0);

  while (!signal.aborted) {
    try {
      if (Date.now() >= planetDueAt.getTime()) {
        await ensureLatestPlanet(log, signal);
        planetDueAt = nextPlanetCheck(env.OSM_PLANET_CHECK_HOUR);
        log.info(
          { nextPlanetCheckAt: planetDueAt },
          "Scheduled next planet check",
        );
      }

      await syncMinutePatches(log, signal);

      const waitMs = Math.max(
        1_000,
        Math.min(
          env.OSM_REPLICATION_POLL_INTERVAL_MS,
          planetDueAt.getTime() - Date.now(),
        ),
      );
      await wait(waitMs, signal);
    } catch (error) {
      if (signal.aborted) break;
      log.error(
        { err: error, retryDelayMs: env.OSM_RETRY_DELAY_MS },
        "OSM ingestion cycle failed; retrying",
      );
      await wait(env.OSM_RETRY_DELAY_MS, signal);
    }
  }
};
