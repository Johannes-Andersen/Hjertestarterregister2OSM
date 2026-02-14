import {
  configure as configureOsmApi,
  getFeature,
  type OsmNode,
  type Tags,
  uploadChangeset,
} from "osm-api";
import * as z from "zod";
import { OsmSdkError } from "./errors.ts";
import type {
  AppliedBatch,
  ApplyBatchedChangesArguments,
  ChangePlan,
  OsmSdkClientOptions,
  PlannedNode,
} from "./types.ts";

const configSchema = z.object({
  apiUrl: z
    .string()
    .trim()
    .default("https://api.openstreetmap.org")
    .transform((v) => v.replace(/\/+$/, "")),
  bearerToken: z.string().trim().min(1).optional(),
  userAgent: z
    .string()
    .trim()
    .min(3)
    .default("https://github.com/osmlab/osm-api-js"),
  changesetTags: z.record(z.string(), z.string()).default({}),
});

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
const defaultCommentSubject = "OSM features";
const operationListFormatter = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
});

const sanitizeTags = (tags: Record<string, string | undefined>) => {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined) continue;
    sanitized[key] = value;
  }

  return sanitized;
};

const toPlannedOperations = (changePlan: ChangePlan) => {
  const operations: PlannedOperation[] = [];

  for (const create of changePlan.create) {
    operations.push({
      kind: "create",
      node: create.node,
    });
  }

  for (const modify of changePlan.modify) {
    operations.push({
      kind: "modify",
      before: modify.before,
      after: modify.after,
      tagUpdates: modify.tagUpdates,
    });
  }

  for (const deletion of changePlan.delete) {
    operations.push({
      kind: "delete",
      node: deletion.node,
    });
  }

  return operations;
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
  createCount,
  modifyCount,
  deleteCount,
  commentSubject,
}: {
  createCount: number;
  modifyCount: number;
  deleteCount: number;
  commentSubject: string;
}) => {
  const labels: string[] = [];
  if (createCount > 0) labels.push("Added");
  if (modifyCount > 0) labels.push("Modified");
  if (deleteCount > 0) labels.push("Deleted");

  const actionLabel = labels.length
    ? operationListFormatter.format(labels)
    : "Updated";

  return `${actionLabel} ${commentSubject}`;
};

export class OsmApiClient {
  private readonly apiUrl: string;
  private readonly authHeader: string | undefined;
  private readonly userAgent: string;
  private readonly changesetTags: Tags;

  constructor(options: OsmSdkClientOptions = {}) {
    const config = configSchema.parse(options);
    this.apiUrl = config.apiUrl;
    this.authHeader = config.bearerToken
      ? `Bearer ${config.bearerToken}`
      : undefined;
    this.userAgent = config.userAgent;
    this.changesetTags = config.changesetTags;
    this.applyLibraryConfiguration();
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
      if (error instanceof OsmSdkError) throw error;

      throw new OsmSdkError(
        error instanceof Error
          ? error.message
          : `Failed to fetch OSM node ${nodeId}.`,
        { nodeId, cause: error },
      );
    }
  }

  async applyBatchedChanges({
    changePlan,
    changesetTags,
    commentSubject,
  }: ApplyBatchedChangesArguments): Promise<AppliedBatch> {
    this.ensureWriteAuthorization();

    this.applyLibraryConfiguration();

    try {
      const operations = toPlannedOperations(changePlan);
      if (!operations.length) {
        return {
          changesets: {},
          createCount: 0,
          modifyCount: 0,
          deleteCount: 0,
        };
      }

      const existingNodesById = await this.loadExistingNodes(operations);

      const createNodes: OsmNode[] = [];
      const modifyNodes: OsmNode[] = [];
      const deleteNodes: OsmNode[] = [];

      for (const operation of operations) {
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

      const changesets = await uploadChangeset(
        {
          ...this.changesetTags,
          ...(changesetTags ?? {}),
          comment: buildChangesetComment({
            createCount: createNodes.length,
            modifyCount: modifyNodes.length,
            deleteCount: deleteNodes.length,
            commentSubject: commentSubject ?? defaultCommentSubject,
          }),
        },
        {
          create: createNodes,
          modify: modifyNodes,
          delete: deleteNodes,
        },
      );

      return {
        changesets,
        createCount: createNodes.length,
        modifyCount: modifyNodes.length,
        deleteCount: deleteNodes.length,
      };
    } catch (error) {
      if (error instanceof OsmSdkError) throw error;

      throw new OsmSdkError(
        error instanceof Error
          ? error.message
          : "Failed to apply batched OSM changes.",
        { cause: error },
      );
    }
  }

  private applyLibraryConfiguration() {
    configureOsmApi({
      apiUrl: this.apiUrl,
      userAgent: this.userAgent,
      authHeader: this.authHeader,
    });
  }

  private ensureWriteAuthorization() {
    if (this.authHeader) return;

    throw new OsmSdkError(
      "Missing OSM auth configuration. Provide bearerToken when creating OsmApiClient.",
    );
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
