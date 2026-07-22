import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChangePlan, PlannedNode } from "@repo/osm-sdk";
import pkg from "../package.json" with { type: "json" };

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const tagXml = (tags: Record<string, string | undefined>): string =>
  Object.entries(tags)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([k, v]) => `      <tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>`)
    .join("\n");

const nodeXml = (node: PlannedNode): string => {
  const attrs = `id="${node.id}" lat="${node.lat}" lon="${node.lon}" version="${node.version}"`;
  const tags = tagXml(node.tags);
  return tags
    ? `    <node ${attrs}>\n${tags}\n    </node>`
    : `    <node ${attrs}/>`;
};

const section = (name: string, nodes: PlannedNode[]): string | null =>
  nodes.length === 0
    ? null
    : `  <${name}>\n${nodes.map(nodeXml).join("\n")}\n  </${name}>`;

/** Serialize a change plan as an osmChange (`.osc`) document. */
const buildOsc = (plan: ChangePlan): string => {
  const generator = `hjertestarterregister2osm v${pkg.version}`;
  const sections = [
    section(
      "create",
      plan.create.map((c) => c.node),
    ),
    section(
      "modify",
      plan.modify.map((m) => m.after),
    ),
    section(
      "delete",
      plan.delete.map((d) => d.node),
    ),
  ].filter((s): s is string => s !== null);

  return `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<osmChange version="0.6" generator="${escapeXml(generator)}">`,
    ...sections,
    "</osmChange>",
  ].join("\n")}\n`;
};

const feature = (
  action: "create" | "modify" | "delete",
  node: PlannedNode,
) => ({
  type: "Feature" as const,
  geometry: { type: "Point" as const, coordinates: [node.lon, node.lat] },
  properties: {
    _action: action,
    _id: node.id,
    _version: node.version,
    ...node.tags,
  },
});

/** Serialize a change plan as a GeoJSON `FeatureCollection`. */
const buildGeojson = (plan: ChangePlan): string =>
  `${JSON.stringify(
    {
      type: "FeatureCollection",
      features: [
        ...plan.create.map((c) => feature("create", c.node)),
        ...plan.modify.map((m) => feature("modify", m.after)),
        ...plan.delete.map((d) => feature("delete", d.node)),
      ],
    },
    null,
    2,
  )}\n`;

/**
 * Write one `.osc` and one `.geojson` preview artifact per changeset into `dir`,
 * so runs accumulate a reviewable history over time. Filenames are prefixed with
 * an ISO timestamp for chronological ordering.
 */
export const writePreview = async (
  dir: string,
  changeId: string,
  plan: ChangePlan,
): Promise<{ osc: string; geojson: string }> => {
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeId = changeId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const base = `${stamp}_${safeId}`;
  const osc = join(dir, `${base}.osc`);
  const geojson = join(dir, `${base}.geojson`);
  await Promise.all([
    writeFile(osc, buildOsc(plan), "utf8"),
    writeFile(geojson, buildGeojson(plan), "utf8"),
  ]);
  return { osc, geojson };
};
