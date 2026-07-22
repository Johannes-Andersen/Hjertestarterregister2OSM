import { aedHandler } from "./aed/handler.ts";
import type { OsmNodeHandler } from "./types.ts";

// Register future OSM feature handlers here. Each handler owns its own storage
// and is offered every matching node during planet imports and minute syncs.
export const handlers: OsmNodeHandler[] = [aedHandler];
