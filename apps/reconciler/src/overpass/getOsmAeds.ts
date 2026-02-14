import { OverpassApiClient, type OverpassResponse } from "@repo/overpass-sdk";
import { overpassConfig } from "../config.ts";

const overpassClient = new OverpassApiClient({
  apiUrl: process.env.OVERPASS_API_URL,
  maxRetries: overpassConfig.maxRetries,
  requestTimeoutMs: overpassConfig.requestTimeoutMs,
});

const query = `
  [out:json][timeout:${overpassConfig.queryTimeoutSeconds}];
  // fetch area "Norway" to search in
  area(id:3602978650)->.searchArea;

  // gather results for emergency=defibrillator
  (
    nwr["emergency"="defibrillator"](area.searchArea);
  );

  // print results
  out geom;
`;

export const getOsmAeds = async (): Promise<OverpassResponse> => {
  return overpassClient.query(query);
};
