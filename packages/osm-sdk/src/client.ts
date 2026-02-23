import {
  configure as configureOsmApi,
  getFeature,
  getFeatures,
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
} from "./types.ts";
import {
  assignUniqueCreateNodeIds,
  buildChangesetComment,
  createNodeFromPlan,
  defaultCommentSubject,
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
      const plan = assignUniqueCreateNodeIds(changePlan);

      if (!plan.create.length && !plan.modify.length && !plan.delete.length) {
        return {
          changesets: {},
          createCount: 0,
          modifyCount: 0,
          deleteCount: 0,
        };
      }

      const existingNodesById = await this.loadExistingNodes(plan);

      const createNodes = plan.create.map((c) => createNodeFromPlan(c.node));

      const modifyNodes = plan.modify.map((m) => {
        const existingNode = existingNodesById.get(m.after.id);
        if (!existingNode) {
          throw new OsmSdkError(`OSM node ${m.after.id} not found for modify`, {
            nodeId: m.after.id,
          });
        }

        const nextTags = { ...(existingNode.tags ?? {}) };
        for (const [key, value] of Object.entries(m.tagUpdates)) {
          if (value === undefined) {
            delete nextTags[key];
          } else {
            nextTags[key] = value;
          }
        }

        return {
          ...existingNode,
          lat: m.after.lat,
          lon: m.after.lon,
          tags: nextTags,
        };
      });

      const deleteNodes = plan.delete.map((d) => {
        const existingNode = existingNodesById.get(d.node.id);
        if (!existingNode) {
          throw new OsmSdkError(`OSM node ${d.node.id} not found for delete`, {
            nodeId: d.node.id,
          });
        }
        return existingNode;
      });

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
        { create: createNodes, modify: modifyNodes, delete: deleteNodes },
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
    changePlan: ChangePlan,
  ): Promise<Map<number, OsmNode>> {
    const nodeIds = new Set<number>();

    for (const modify of changePlan.modify) {
      nodeIds.add(modify.after.id);
    }

    for (const deletion of changePlan.delete) {
      nodeIds.add(deletion.node.id);
    }

    if (nodeIds.size === 0) return new Map();

    const nodes = await getFeatures("node", [...nodeIds]);
    const nodesById = new Map<number, OsmNode>();
    for (const node of nodes) {
      nodesById.set(node.id, node);
    }

    return nodesById;
  }
}
