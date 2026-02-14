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
  OsmSdkClientOptions,
  PlannedOperation,
} from "./types.ts";
import {
  buildChangesetComment,
  createNodeFromPlan,
  defaultCommentSubject,
  toPlannedOperations,
} from "./utils.ts";

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

          const nextTags = {
            ...(existingNode.tags ?? {}),
          };

          for (const [key, value] of Object.entries(operation.tagUpdates)) {
            if (value === undefined) {
              delete nextTags[key];
              continue;
            }

            nextTags[key] = value;
          }

          modifyNodes.push({
            ...existingNode,
            lat: operation.after.lat,
            lon: operation.after.lon,
            tags: nextTags,
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
