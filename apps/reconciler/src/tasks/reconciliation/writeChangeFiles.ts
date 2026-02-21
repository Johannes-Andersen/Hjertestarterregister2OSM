import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ChangePlan, PlannedNode } from "@repo/osm-sdk";
import type { Logger } from "pino";
import { reconcilerConfig } from "../../config.ts";

interface WriteChangeFilesOptions {
  logger: Logger;
  changePlan: ChangePlan;
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

const sanitizeTags = (
  tags: Record<string, string | undefined>,
): Record<string, string> => {
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

const buildOsc = (changePlan: ChangePlan): string => {
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

const buildGeoJson = (changePlan: ChangePlan) => {
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

const assignCreateNodeIds = (changePlan: ChangePlan): ChangePlan => {
  let nextId = -1;

  return {
    ...changePlan,
    create: changePlan.create.map((change) => ({
      ...change,
      node: {
        ...change.node,
        id: change.node.id === -1 ? nextId-- : change.node.id,
      },
    })),
  };
};

/**
 * Merge multiple ChangePlans into a single combined plan.
 */
const mergeChangePlans = (plans: ChangePlan[]): ChangePlan => ({
  create: plans.flatMap((p) => p.create),
  modify: plans.flatMap((p) => p.modify),
  delete: plans.flatMap((p) => p.delete),
});

export const writeChangeFiles = async ({
  logger,
  changePlan: rawChangePlan,
}: WriteChangeFilesOptions): Promise<OutputPaths> => {
  const log = logger.child({ task: "writeChangeFiles" });
  log.info("Writing change files to disk");

  const changePlan = assignCreateNodeIds(rawChangePlan);

  const oscPath = resolve(process.cwd(), reconcilerConfig.previewOscOutputPath);
  const geojsonPath = resolve(
    process.cwd(),
    reconcilerConfig.previewGeojsonOutputPath,
  );

  await Promise.all([
    mkdir(dirname(oscPath), { recursive: true }),
    mkdir(dirname(geojsonPath), { recursive: true }),
  ]);

  const hasChanges =
    changePlan.create.length > 0 ||
    changePlan.modify.length > 0 ||
    changePlan.delete.length > 0;

  await Promise.all([
    writeFile(oscPath, buildOsc(changePlan), "utf8"),
    writeFile(
      geojsonPath,
      `${JSON.stringify(buildGeoJson(changePlan), null, 2)}\n`,
      "utf8",
    ),
  ]);

  log.info(
    {
      oscPath,
      geojsonPath,
      hasChanges,
      creates: changePlan.create.length,
      modifies: changePlan.modify.length,
      deletes: changePlan.delete.length,
    },
    "Change files written to disk",
  );

  return { oscPath, geojsonPath };
};

export { mergeChangePlans };
