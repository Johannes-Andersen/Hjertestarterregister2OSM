import {
  configure as configureOsmApi,
  getFeature,
  type OsmNode,
  type Tags,
  uploadChangeset,
} from "osm-api";
import { OsmSdkError } from "./errors.ts";
import type {
  AppliedBatch,
  ApplyBatchedChangesArguments,
  ChangePlan,
  OsmSdkClientOptions,
  OsmSdkConfiguration,
  PlannedNode,
} from "./types.ts";

const defaultApiUrl = "https://api.openstreetmap.org";
const defaultUserAgent = "https://github.com/osmlab/osm-api-js";
const defaultBatchCommentPrefix = "Batch sync changes";

type Coordinate = { lat: number; lon: number };

type ResolvedConfiguration = {
  apiUrl: string;
  authHeader?: string;
  userAgent: string;
  changesetTags: Tags;
};

type CreateOperation = {
  kind: "create";
  node: PlannedNode;
};

type ModifyOperation = {
  kind: "modify";
  before: PlannedNode;
  after: PlannedNode;
  tagUpdates: Record<string, string | undefined>;
};

type DeleteOperation = {
  kind: "delete";
  node: PlannedNode;
};

type PlannedOperation = CreateOperation | ModifyOperation | DeleteOperation;

interface OperationWithCoordinate {
  operation: PlannedOperation;
  coordinate: Coordinate;
}

const normalizeApiUrl = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new OsmSdkError("apiUrl must be a non-empty string.");
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
};

const normalizeOptionalString = (value: string): string | undefined => {
  const normalized = value.trim();
  return normalized ? normalized : undefined;
};

const toRad = (value: number): number => (value * Math.PI) / 180;

const coordinateDistance = (left: Coordinate, right: Coordinate): number => {
  const earthRadiusMeters = 6_371_000;

  const dLat = toRad(right.lat - left.lat);
  const dLon = toRad(right.lon - left.lon);

  const lat1 = toRad(left.lat);
  const lat2 = toRad(right.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
};

const sanitizeTags = (tags: Record<string, string | undefined>) => {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined) continue;
    sanitized[key] = value;
  }

  return sanitized;
};

const toOperationWithCoordinates = (changePlan: ChangePlan) => {
  const operations: OperationWithCoordinate[] = [];

  for (const create of changePlan.create) {
    operations.push({
      operation: {
        kind: "create",
        node: create.node,
      },
      coordinate: { lat: create.node.lat, lon: create.node.lon },
    });
  }

  for (const modify of changePlan.modify) {
    operations.push({
      operation: {
        kind: "modify",
        before: modify.before,
        after: modify.after,
        tagUpdates: modify.tagUpdates,
      },
      coordinate: { lat: modify.after.lat, lon: modify.after.lon },
    });
  }

  for (const deletion of changePlan.delete) {
    operations.push({
      operation: {
        kind: "delete",
        node: deletion.node,
      },
      coordinate: { lat: deletion.node.lat, lon: deletion.node.lon },
    });
  }

  operations.sort(
    (left, right) =>
      left.coordinate.lat - right.coordinate.lat ||
      left.coordinate.lon - right.coordinate.lon,
  );

  return operations;
};

const groupOperationsByDistance = (
  operations: OperationWithCoordinate[],
  maxDistanceMeters: number,
) => {
  const batches: OperationWithCoordinate[][] = [];

  for (const operation of operations) {
    let matchingBatch: OperationWithCoordinate[] | undefined;

    for (const candidateBatch of batches) {
      const allWithinDistance = candidateBatch.every(
        (candidateOperation) =>
          coordinateDistance(
            candidateOperation.coordinate,
            operation.coordinate,
          ) <= maxDistanceMeters,
      );

      if (!allWithinDistance) continue;

      matchingBatch = candidateBatch;
      break;
    }

    if (matchingBatch) {
      matchingBatch.push(operation);
      continue;
    }

    batches.push([operation]);
  }

  return batches;
};

const calculateMaxBatchSpanMeters = (batch: OperationWithCoordinate[]) => {
  let maxDistanceMeters = 0;

  for (let i = 0; i < batch.length; i++) {
    for (let j = i + 1; j < batch.length; j++) {
      const left = batch[i];
      const right = batch[j];
      if (!left || !right) continue;

      const distanceMeters = coordinateDistance(
        left.coordinate,
        right.coordinate,
      );
      if (distanceMeters > maxDistanceMeters) {
        maxDistanceMeters = distanceMeters;
      }
    }
  }

  return maxDistanceMeters;
};

const createNodeFromPlan = (plannedNode: PlannedNode): OsmNode => ({
  type: "node",
  lat: plannedNode.lat,
  lon: plannedNode.lon,
  tags: sanitizeTags(plannedNode.tags),
  version: plannedNode.version ?? 0,
  timestamp: "",
  changeset: -1,
  user: "",
  uid: -1,
  id: plannedNode.id,
});

const buildChangesetComment = ({
  batchIndex,
  totalBatches,
  createCount,
  modifyCount,
  deleteCount,
  maxSpanMeters,
  commentPrefix,
}: {
  batchIndex: number;
  totalBatches: number;
  createCount: number;
  modifyCount: number;
  deleteCount: number;
  maxSpanMeters: number;
  commentPrefix: string;
}) =>
  `${commentPrefix} ${batchIndex + 1}/${totalBatches}: ${createCount} create, ${modifyCount} modify, ${deleteCount} delete (span ${(maxSpanMeters / 1000).toFixed(1)} km)`;

const isFinitePositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const toError = (error: unknown, fallbackMessage: string): OsmSdkError => {
  if (error instanceof OsmSdkError) return error;

  if (error instanceof Error) {
    return new OsmSdkError(error.message || fallbackMessage, {
      status: typeof error.cause === "number" ? error.cause : undefined,
      cause: error,
    });
  }

  return new OsmSdkError(fallbackMessage, { cause: error });
};

export class OsmApiClient {
  private configuration: ResolvedConfiguration = {
    apiUrl: defaultApiUrl,
    userAgent: defaultUserAgent,
    changesetTags: {},
  };

  constructor(options: OsmSdkClientOptions = {}) {
    this.configure(options);
  }

  configure(updatedConfig: OsmSdkConfiguration): void {
    if (updatedConfig.apiUrl !== undefined) {
      this.configuration.apiUrl = normalizeApiUrl(updatedConfig.apiUrl);
    }

    if (updatedConfig.userAgent !== undefined) {
      this.configuration.userAgent =
        normalizeOptionalString(updatedConfig.userAgent) ?? defaultUserAgent;
    }

    if (updatedConfig.authHeader !== undefined) {
      this.configuration.authHeader = normalizeOptionalString(
        updatedConfig.authHeader,
      );
    }

    if (updatedConfig.bearerToken !== undefined) {
      const token = normalizeOptionalString(updatedConfig.bearerToken);
      this.configuration.authHeader = token ? `Bearer ${token}` : undefined;
    }

    if (updatedConfig.changesetTags !== undefined) {
      this.configuration.changesetTags = { ...updatedConfig.changesetTags };
    }

    this.applyLibraryConfiguration();
  }

  getConfig(): Readonly<ResolvedConfiguration> {
    return {
      ...this.configuration,
      changesetTags: { ...this.configuration.changesetTags },
    };
  }

  async getNodeFeature(nodeId: number): Promise<OsmNode> {
    this.applyLibraryConfiguration();

    try {
      const [feature] = await getFeature("node", nodeId);

      if (!feature) {
        throw new OsmSdkError(`OSM node ${nodeId} not found`, { nodeId });
      }

      return feature;
    } catch (error) {
      const sdkError = toError(error, `Failed to fetch OSM node ${nodeId}.`);
      if (sdkError.nodeId === undefined) {
        throw new OsmSdkError(sdkError.message, {
          status: sdkError.status,
          statusText: sdkError.statusText,
          url: sdkError.url,
          nodeId,
          responseBody: sdkError.responseBody,
          cause: sdkError,
        });
      }

      throw sdkError;
    }
  }

  async applyBatchedChanges({
    changePlan,
    maxDistanceMeters,
    changesetTags,
    commentPrefix,
  }: ApplyBatchedChangesArguments): Promise<AppliedBatch[]> {
    this.ensureWriteAuthorization();

    if (!isFinitePositiveNumber(maxDistanceMeters)) {
      throw new OsmSdkError("maxDistanceMeters must be a positive number.");
    }

    this.applyLibraryConfiguration();

    try {
      const operationsWithCoordinates = toOperationWithCoordinates(changePlan);
      if (!operationsWithCoordinates.length) return [];

      const batches = groupOperationsByDistance(
        operationsWithCoordinates,
        maxDistanceMeters,
      );
      const appliedBatches: AppliedBatch[] = [];

      for (const [batchIndex, batchWithCoordinates] of batches.entries()) {
        const batchOperations = batchWithCoordinates.map(
          (item) => item.operation,
        );
        const existingNodesById = await this.loadExistingNodes(batchOperations);

        const createNodes: OsmNode[] = [];
        const modifyNodes: OsmNode[] = [];
        const deleteNodes: OsmNode[] = [];

        for (const operation of batchOperations) {
          if (operation.kind === "create") {
            createNodes.push(createNodeFromPlan(operation.node));
            continue;
          }

          if (operation.kind === "modify") {
            const existingNode = existingNodesById.get(operation.after.id);
            if (!existingNode) {
              throw new OsmSdkError(
                `OSM node ${operation.after.id} not found for modify`,
                { nodeId: operation.after.id },
              );
            }

            const tagPatch = sanitizeTags(operation.tagUpdates);
            modifyNodes.push({
              ...existingNode,
              lat: operation.after.lat,
              lon: operation.after.lon,
              tags: {
                ...(existingNode.tags ?? {}),
                ...tagPatch,
              },
            });

            continue;
          }

          const existingNode = existingNodesById.get(operation.node.id);
          if (!existingNode) {
            throw new OsmSdkError(
              `OSM node ${operation.node.id} not found for delete`,
              { nodeId: operation.node.id },
            );
          }

          deleteNodes.push(existingNode);
        }

        const maxSpanMeters = calculateMaxBatchSpanMeters(batchWithCoordinates);
        const changesets = await uploadChangeset(
          {
            ...this.resolveChangesetTags(changesetTags),
            comment: buildChangesetComment({
              batchIndex,
              totalBatches: batches.length,
              createCount: createNodes.length,
              modifyCount: modifyNodes.length,
              deleteCount: deleteNodes.length,
              maxSpanMeters,
              commentPrefix: commentPrefix ?? defaultBatchCommentPrefix,
            }),
          },
          {
            create: createNodes,
            modify: modifyNodes,
            delete: deleteNodes,
          },
        );

        appliedBatches.push({
          changesets,
          createCount: createNodes.length,
          modifyCount: modifyNodes.length,
          deleteCount: deleteNodes.length,
          maxSpanMeters,
        });
      }

      return appliedBatches;
    } catch (error) {
      throw toError(error, "Failed to apply batched OSM changes.");
    }
  }

  private applyLibraryConfiguration() {
    configureOsmApi({
      apiUrl: this.configuration.apiUrl,
      userAgent: this.configuration.userAgent,
      authHeader: this.configuration.authHeader,
    });
  }

  private ensureWriteAuthorization() {
    if (this.configuration.authHeader) return;

    throw new OsmSdkError(
      "Missing OSM auth configuration. Call OSM.configure({ authHeader: `Bearer <token>` }) or OSM.configure({ bearerToken: token }) before write operations.",
    );
  }

  private resolveChangesetTags(override?: Tags): Tags {
    return {
      ...this.configuration.changesetTags,
      ...(override ?? {}),
    };
  }

  private async loadExistingNodes(
    operations: PlannedOperation[],
  ): Promise<Map<number, OsmNode>> {
    const existingNodeIds = new Set<number>();

    for (const operation of operations) {
      if (operation.kind === "modify") {
        existingNodeIds.add(operation.after.id);
        continue;
      }

      if (operation.kind === "delete") {
        existingNodeIds.add(operation.node.id);
      }
    }

    const existingNodesById = new Map<number, OsmNode>();
    for (const nodeId of existingNodeIds) {
      const existingNode = await this.getNodeFeature(nodeId);
      existingNodesById.set(nodeId, existingNode);
    }

    return existingNodesById;
  }
}

export const OSM = new OsmApiClient();
