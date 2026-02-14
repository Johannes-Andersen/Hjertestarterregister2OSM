import type { OverpassResponse } from "@repo/overpass-sdk";
import { overpassClient } from "../clients/overpassClient.ts";
import { overpassConfig } from "../config.ts";

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

export const getOsmAeds = async (): Promise<OverpassResponse> =>
  overpassClient.query(query);
