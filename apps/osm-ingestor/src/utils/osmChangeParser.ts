import { gunzipSync } from "node:zlib";
import sax, { type QualifiedTag, type Tag } from "sax";
import type { OsmElementInfo } from "./osmAed.ts";

export type OsmChangeAction = "create" | "modify" | "delete";

export interface OsmNodeChange {
  action: OsmChangeAction;
  id: number;
  lat: number | null;
  lon: number | null;
  tags: Record<string, string>;
  info: OsmElementInfo;
}

interface ParseOsmChangeBufferOptions {
  compressed?: boolean;
}

const attr = (tag: Tag | QualifiedTag, name: string): string | undefined => {
  const value = tag.attributes[name];
  if (typeof value === "string") return value;
  return value?.value;
};

const integerAttr = (tag: Tag | QualifiedTag, name: string): number | null => {
  const value = attr(tag, name);
  if (!value) return null;

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

const numberAttr = (tag: Tag | QualifiedTag, name: string): number | null => {
  const value = attr(tag, name);
  if (!value) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const infoFromNode = (tag: Tag | QualifiedTag): OsmElementInfo => {
  const info: OsmElementInfo = {};
  const version = integerAttr(tag, "version");
  const changeset = integerAttr(tag, "changeset");
  const uid = integerAttr(tag, "uid");
  const user = attr(tag, "user");
  const timestamp = attr(tag, "timestamp");

  if (version !== null) info.version = version;
  if (changeset !== null) info.changeset = changeset;
  if (uid !== null) info.uid = uid;
  if (user) info.user = user;
  if (timestamp) info.timestamp = timestamp;

  return info;
};

export const parseOsmChangeBuffer = (
  buffer: Buffer,
  { compressed = true }: ParseOsmChangeBufferOptions = {},
): OsmNodeChange[] => {
  const xml = (compressed ? gunzipSync(buffer) : buffer).toString("utf8");
  const changes: OsmNodeChange[] = [];
  const saxParser = sax.parser(true, {
    lowercase: false,
    normalize: false,
    trim: false,
  });

  let currentAction: OsmChangeAction | null = null;
  let currentNode: OsmNodeChange | null = null;

  saxParser.onopentag = (tag) => {
    if (
      tag.name === "create" ||
      tag.name === "modify" ||
      tag.name === "delete"
    ) {
      currentAction = tag.name;
      return;
    }

    if (tag.name === "node" && currentAction) {
      const id = integerAttr(tag, "id");
      if (id === null || id <= 0) {
        throw new Error("OSM change node is missing a valid positive id.");
      }

      currentNode = {
        action: currentAction,
        id,
        lat: numberAttr(tag, "lat"),
        lon: numberAttr(tag, "lon"),
        tags: {},
        info: infoFromNode(tag),
      };
      return;
    }

    if (tag.name !== "tag" || currentNode === null) return;

    const key = attr(tag, "k");
    const value = attr(tag, "v");
    if (key && value !== undefined) currentNode.tags[key] = value;
  };

  saxParser.onclosetag = (tagName) => {
    if (tagName === "node" && currentNode !== null) {
      changes.push(currentNode);
      currentNode = null;
      return;
    }

    if (tagName === "create" || tagName === "modify" || tagName === "delete") {
      currentAction = null;
    }
  };

  saxParser.onerror = (error) => {
    throw error;
  };

  saxParser.write(xml).close();
  return changes;
};
