import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PlannedNode, ReconciliationChangePlan } from "./changePlan.ts";

interface Arguments {
  changePlan: ReconciliationChangePlan;
  oscOutputPath: string;
  geojsonOutputPath: string;
}

interface OutputPaths {
  oscPath: string;
  geojsonPath: string;
}

const xmlEscape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const sanitizeTags = (tags: Record<string, string | undefined>) => {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined) continue;
    sanitized[key] = value;
  }

  return sanitized;
};

const renderNodeXml = (
  node: PlannedNode,
  fallbackVersion: number,
): string[] => {
  const tags = sanitizeTags(node.tags);
  const tagLines = Object.entries(tags)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, value]) =>
        `      <tag k="${xmlEscape(key)}" v="${xmlEscape(value)}" />`,
    );

  return [
    `    <node id="${node.id}" lat="${node.lat}" lon="${node.lon}" version="${node.version ?? fallbackVersion}">`,
    ...tagLines,
    "    </node>",
  ];
};

const buildOsc = (changePlan: ReconciliationChangePlan) => {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<osmChange version="0.6" generator="hjertestarterregister2osm planned-changes">',
    "  <create>",
  ];

  for (const change of changePlan.create) {
    lines.push(...renderNodeXml(change.node, 0));
  }

  lines.push("  </create>", "  <modify>");

  for (const change of changePlan.modify) {
    lines.push(...renderNodeXml(change.after, change.before.version ?? 1));
  }

  lines.push("  </modify>", '  <delete if-unused="true">');

  for (const change of changePlan.delete) {
    lines.push(...renderNodeXml(change.node, 1));
  }

  lines.push("  </delete>", "</osmChange>", "");

  return lines.join("\n");
};

type GeoJsonFeature = {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: Record<string, string | number>;
};

const buildGeoJson = (changePlan: ReconciliationChangePlan) => {
  const features: GeoJsonFeature[] = [];

  for (const change of changePlan.create) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [change.node.lon, change.node.lat],
      },
      properties: {
        _operation: "create",
        _register_id: change.registerId,
        _osm_id: change.node.id,
        ...sanitizeTags(change.node.tags),
      },
    });
  }

  for (const change of changePlan.modify) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [change.after.lon, change.after.lat],
      },
      properties: {
        _operation: "modify",
        _register_id: change.registerId,
        _osm_id: change.after.id,
        _from_lat: change.before.lat,
        _from_lon: change.before.lon,
        ...sanitizeTags(change.after.tags),
      },
    });
  }

  for (const change of changePlan.delete) {
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [change.node.lon, change.node.lat],
      },
      properties: {
        _operation: "delete",
        _register_id: change.registerId,
        _osm_id: change.node.id,
        ...sanitizeTags(change.node.tags),
      },
    });
  }

  return {
    type: "FeatureCollection" as const,
    features,
  };
};

export const writePlannedChangeFiles = async ({
  changePlan,
  oscOutputPath,
  geojsonOutputPath,
}: Arguments): Promise<OutputPaths> => {
  const oscPath = resolve(process.cwd(), oscOutputPath);
  const geojsonPath = resolve(process.cwd(), geojsonOutputPath);

  await Promise.all([
    mkdir(dirname(oscPath), { recursive: true }),
    mkdir(dirname(geojsonPath), { recursive: true }),
  ]);

  await Promise.all([
    writeFile(oscPath, buildOsc(changePlan), "utf8"),
    writeFile(
      geojsonPath,
      `${JSON.stringify(buildGeoJson(changePlan), null, 2)}\n`,
      "utf8",
    ),
  ]);

  return { oscPath, geojsonPath };
};
