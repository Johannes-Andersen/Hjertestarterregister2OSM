import type {
  ChangePlan,
  OsmNode,
  PlannedNode,
  PlannedOperation,
} from "./types.ts";

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

export const toPlannedOperations = (changePlan: ChangePlan) => {
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
