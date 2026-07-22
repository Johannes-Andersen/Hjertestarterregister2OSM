import type { OsmNode, OsmNodeChange } from "../osm/types.ts";

export type OsmSource = "planet" | "minute";

/**
 * A handler owns the storage (latest-state + history tables) for one kind of
 * OSM feature. Register new feature types in `index.ts`; the planet import and
 * minute sync route matching nodes to every handler automatically.
 */
export interface OsmNodeHandler {
  id: string;

  /** Whether a node's tags make it relevant to this handler. */
  matches(tags: Record<string, string> | undefined): boolean;

  /** Upsert matched nodes into the latest-state table and append history. */
  upsert(
    nodes: OsmNode[],
    source: OsmSource,
    sequence?: number,
  ): Promise<number>;

  /** Soft-delete tracked elements that were deleted or no longer match. */
  markDeleted(
    changes: OsmNodeChange[],
    source: OsmSource,
    sequence?: number,
  ): Promise<number>;

  /** Planet reconciliation: soft-delete stored elements absent from the snapshot. */
  reconcile(seenIds: number[], planetTimestamp: Date): Promise<number>;
}
