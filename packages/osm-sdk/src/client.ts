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

      const createNodes = plan.create.map((c) => createNodeFromPlan(c.node));
      const modifyNodes = plan.modify.map((m) => createNodeFromPlan(m.after));
      const deleteNodes = plan.delete.map((d) => createNodeFromPlan(d.node));

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
}
