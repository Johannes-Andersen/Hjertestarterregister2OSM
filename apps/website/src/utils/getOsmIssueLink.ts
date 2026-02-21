import type {
  SyncOsmElementType,
  SyncRunIssueListItem,
} from "@repo/sync-store";

interface OSMIssueLink {
  href: string;
  label: string;
  id: number;
  type: SyncOsmElementType;
}

const capitalize = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

export const getOsmIssueLink = (
  issue: SyncRunIssueListItem,
): OSMIssueLink | null => {
  if (issue.osmNodeId === null || issue.osmElementType === null) return null;
  const type = issue.osmElementType;

  return {
    href: `https://www.openstreetmap.org/${type}/${issue.osmNodeId}`,
    label: `${capitalize(type)} ${issue.osmNodeId}`,
    id: issue.osmNodeId,
    type,
  };
};
