import type { ChangePlan, OsmNode, PlannedNode } from "./types.ts";

export const defaultCommentSubject = "OSM features";
export const operationListFormatter = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
});

export const sanitizeTags = (tags: Record<string, string | undefined>) => {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined) continue;
    sanitized[key] = value;
  }

  return sanitized;
};

export const assignUniqueCreateNodeIds = (
  changePlan: ChangePlan,
): ChangePlan => {
  const usedCreateIds = new Set<number>();
  let nextPlaceholderId = -1;

  return {
    ...changePlan,
    create: changePlan.create.map((change) => {
      const requestedId = change.node.id;
      const canReuseRequestedId =
        requestedId < 0 && !usedCreateIds.has(requestedId);

      let assignedId = requestedId;
      if (!canReuseRequestedId) {
        while (usedCreateIds.has(nextPlaceholderId)) {
          nextPlaceholderId -= 1;
        }

        assignedId = nextPlaceholderId;
        nextPlaceholderId -= 1;
      }

      usedCreateIds.add(assignedId);

      return {
        ...change,
        node: {
          ...change.node,
          id: assignedId,
        },
      };
    }),
  };
};

export const createNodeFromPlan = (plannedNode: PlannedNode): OsmNode => ({
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

export const buildChangesetComment = ({
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
