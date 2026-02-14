import type { OverpassResponse } from "@repo/overpass-sdk";
import { overpassClient } from "../clients/overpassClient.ts";
import { overpassConfig } from "../config.ts";
import { norwayBoundary } from "../data/norwayBoundary.ts";

type PolygonRing = readonly (readonly [number, number])[];

const toOverpassPolyString = (ring: PolygonRing) =>
  ring.map(([lon, lat]) => `${lat} ${lon}`).join(" ");

const buildDefibrillatorPolyQueryClauses = () =>
  norwayBoundary.coordinates
    .map((polygon) => polygon[0])
    .filter((ring) => Array.isArray(ring) && ring.length > 2)
    .map((ring) => ring as PolygonRing)
    .map(
      (ring) =>
        `    nwr["emergency"="defibrillator"](poly:"${toOverpassPolyString(ring)}");`,
    )
    .join("\n");

const query = `
  [out:json][timeout:${overpassConfig.queryTimeoutSeconds}];
  // gather results for emergency=defibrillator within Norway polygon
  (
${buildDefibrillatorPolyQueryClauses()}
  );

  // print results
  out geom;
`;

export const getOsmAeds = async (): Promise<OverpassResponse> =>
  overpassClient.query(query);
