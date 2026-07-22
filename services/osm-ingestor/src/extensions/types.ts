import type { OsmReplicationState } from "../repositories/osmStateRepository.ts";
import type { OsmNodeLike } from "../types/osm.ts";
import type { OsmNodeChange } from "../utils/osmChangeParser.ts";

export interface ExtensionResult {
  extension: string;
  metrics: Record<string, number>;
}

export interface PlanetImportSession {
  accept(node: OsmNodeLike): void | Promise<void>;
  finish(replicationState: OsmReplicationState): Promise<ExtensionResult>;
}

export interface OsmNodeExtension {
  id: string;
  createPlanetImportSession(batchSize: number): PlanetImportSession;
  applyMinuteChanges(
    changes: OsmNodeChange[],
    replicationSequence: number,
  ): Promise<ExtensionResult>;
}
