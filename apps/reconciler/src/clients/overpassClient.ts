import { OverpassApiClient } from "@repo/overpass-sdk";
import { overpassConfig } from "../config.ts";

export const overpassClient = new OverpassApiClient({
  apiUrl: overpassConfig.apiUrl,
  maxRetries: overpassConfig.maxRetries,
  minRetryDelayMs: overpassConfig.minRetryDelayMs,
});
