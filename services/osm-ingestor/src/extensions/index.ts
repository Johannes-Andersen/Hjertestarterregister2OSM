import { aedExtension } from "./aed/extension.ts";
import type { OsmNodeExtension } from "./types.ts";

// Register future node extensions here. Each extension owns its matching,
// persistence schema, history rules, and planet reconciliation behavior.
export const nodeExtensions: OsmNodeExtension[] = [aedExtension];
