import type { OsmNodeLike } from "../../types/osm.ts";
import type { OsmNodeChange } from "../../utils/osmChangeParser.ts";
import type {
  ExtensionResult,
  OsmNodeExtension,
  PlanetImportSession,
} from "../types.ts";
import {
  hasAedTags,
  type OsmAedKey,
  type OsmAedRemovalRow,
  type OsmAedRow,
  toOsmAedKey,
  transformOsmNodeAedForStorage,
  transformOsmNodeRemovalForStorage,
} from "./osmAed.ts";
import {
  markMissingOsmAedsDeleted,
  markOsmAedsDeleted,
  upsertOsmAeds,
} from "./repository.ts";

const extensionId = "aed";

const keyString = (id: number): string => `node/${id}`;

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

const changeToRemoval = (
  change: OsmNodeChange,
  isDeleted: boolean,
): OsmAedRemovalRow =>
  transformOsmNodeRemovalForStorage({
    node: {
      type: "node",
      id: change.id,
      lat: change.lat ?? Number.NaN,
      lon: change.lon ?? Number.NaN,
      tags: change.tags,
      info: change.info,
    },
    isDeleted,
  });

const createPlanetImportSession = (batchSize: number): PlanetImportSession => {
  let batch: OsmAedRow[] = [];
  const foundKeys: OsmAedKey[] = [];
  let matched = 0;
  let upserted = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    const currentBatch = batch;
    batch = [];
    const result = await upsertOsmAeds(currentBatch, { source: "planet" });
    upserted += result.upserted;
  };

  return {
    accept(node) {
      if (!hasAedTags(node.tags)) return;

      matched++;
      foundKeys.push(toOsmAedKey(node));
      batch.push(transformOsmNodeAedForStorage(node));
      if (batch.length >= batchSize) return flush();
    },

    async finish(replicationState): Promise<ExtensionResult> {
      await flush();
      if (matched === 0) {
        throw new Error(
          "Planet file contained no AED nodes; refusing AED reconciliation.",
        );
      }
      const { deleted } = await markMissingOsmAedsDeleted(
        foundKeys,
        replicationState.timestamp,
      );
      return {
        extension: extensionId,
        metrics: { matched, upserted, deletedMissing: deleted },
      };
    },
  };
};

const applyMinuteChanges = async (
  changes: OsmNodeChange[],
  replicationSequence: number,
): Promise<ExtensionResult> => {
  const upserts = new Map<string, OsmAedRow>();
  const removals = new Map<string, OsmAedRemovalRow>();
  let matched = 0;
  let missingCoordinates = 0;

  for (const change of changes) {
    const key = keyString(change.id);
    if (change.action === "delete") {
      removals.set(key, changeToRemoval(change, true));
      upserts.delete(key);
      continue;
    }

    const node = changeToNode(change);
    if (!node) {
      if (hasAedTags(change.tags)) missingCoordinates++;
      removals.set(key, changeToRemoval(change, false));
      upserts.delete(key);
      continue;
    }

    if (hasAedTags(node.tags)) {
      matched++;
      upserts.set(key, transformOsmNodeAedForStorage(node));
      removals.delete(key);
      continue;
    }

    removals.set(key, changeToRemoval(change, false));
    upserts.delete(key);
  }

  const context = {
    source: "minute" as const,
    replicationSequence,
  };
  const [{ upserted }, { deleted }] = await Promise.all([
    upserts.size > 0
      ? upsertOsmAeds([...upserts.values()], context)
      : { upserted: 0 },
    removals.size > 0
      ? markOsmAedsDeleted([...removals.values()], context)
      : { deleted: 0 },
  ]);

  return {
    extension: extensionId,
    metrics: {
      matched,
      missingCoordinates,
      upserted,
      deleted,
    },
  };
};

export const aedExtension: OsmNodeExtension = {
  id: extensionId,
  createPlanetImportSession,
  applyMinuteChanges,
};
