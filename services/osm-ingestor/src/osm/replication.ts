import { gunzipSync } from "node:zlib";
import sax, { type QualifiedTag, type Tag } from "sax";
import { env } from "../config.ts";
import type {
  OsmChangeAction,
  OsmElementInfo,
  OsmNodeChange,
} from "./types.ts";

export interface ReplicationState {
  sequence: number;
  timestamp: Date;
  baseUrl: string;
}

const normalizeBaseUrl = (baseUrl: string): string =>
  baseUrl.replace(/\/+$/, "");

/** e.g. 1234567 -> "001/234/567.osc.gz" */
const sequencePath = (sequence: number, suffix: string): string => {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error(`Invalid OSM replication sequence: ${sequence}`);
  }
  const padded = String(sequence).padStart(9, "0");
  return `${padded.slice(0, 3)}/${padded.slice(3, 6)}/${padded.slice(6)}${suffix}`;
};

const fetchOsm = async (
  url: string,
  accept: string,
  signal?: AbortSignal,
): Promise<Response> => {
  const response = await fetch(url, {
    headers: { Accept: accept, "User-Agent": env.OSM_USER_AGENT },
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `OSM replication request failed ${response.status}: ${url}`,
    );
  }
  return response;
};

const parseState = (text: string, baseUrl: string): ReplicationState => {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    values.set(
      trimmed.slice(0, separator),
      trimmed.slice(separator + 1).replaceAll("\\:", ":"),
    );
  }

  const sequence = Number(values.get("sequenceNumber"));
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error("OSM replication state is missing sequenceNumber.");
  }
  const timestampValue = values.get("timestamp");
  const timestamp = timestampValue ? new Date(timestampValue) : new Date(NaN);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid OSM replication timestamp: ${timestampValue}`);
  }

  return { sequence, timestamp, baseUrl };
};

export const getRemoteState = async (
  baseUrl: string,
  signal?: AbortSignal,
): Promise<ReplicationState> => {
  const base = normalizeBaseUrl(baseUrl);
  const response = await fetchOsm(`${base}/state.txt`, "text/plain", signal);
  return parseState(await response.text(), base);
};

export const getStateForSequence = async (
  baseUrl: string,
  sequence: number,
  signal?: AbortSignal,
): Promise<ReplicationState> => {
  const base = normalizeBaseUrl(baseUrl);
  const path = sequencePath(sequence, ".state.txt");
  const response = await fetchOsm(`${base}/${path}`, "text/plain", signal);
  return parseState(await response.text(), base);
};

export const getChangeFile = async (
  baseUrl: string,
  sequence: number,
  signal?: AbortSignal,
): Promise<Buffer> => {
  const base = normalizeBaseUrl(baseUrl);
  const path = sequencePath(sequence, ".osc.gz");
  const response = await fetchOsm(
    `${base}/${path}`,
    "application/gzip",
    signal,
  );
  return Buffer.from(await response.arrayBuffer());
};

const attr = (tag: Tag | QualifiedTag, name: string): string | undefined => {
  const value = tag.attributes[name];
  return typeof value === "string" ? value : value?.value;
};

const intAttr = (tag: Tag | QualifiedTag, name: string): number | null => {
  const value = attr(tag, name);
  const parsed = value ? Number(value) : NaN;
  return Number.isInteger(parsed) ? parsed : null;
};

const numAttr = (tag: Tag | QualifiedTag, name: string): number | null => {
  const value = attr(tag, name);
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const infoFromTag = (tag: Tag | QualifiedTag): OsmElementInfo => {
  const info: OsmElementInfo = {};
  const version = intAttr(tag, "version");
  const changeset = intAttr(tag, "changeset");
  const uid = intAttr(tag, "uid");
  const user = attr(tag, "user");
  const timestamp = attr(tag, "timestamp");
  if (version !== null) info.version = version;
  if (changeset !== null) info.changeset = changeset;
  if (uid !== null) info.uid = uid;
  if (user) info.user = user;
  if (timestamp) info.timestamp = timestamp;
  return info;
};

export const parseChangeFile = (buffer: Buffer): OsmNodeChange[] => {
  const xml = gunzipSync(buffer).toString("utf8");
  const changes: OsmNodeChange[] = [];
  const parser = sax.parser(true, {
    lowercase: false,
    normalize: false,
    trim: false,
  });

  let action: OsmChangeAction | null = null;
  let node: OsmNodeChange | null = null;

  parser.onopentag = (tag) => {
    if (
      tag.name === "create" ||
      tag.name === "modify" ||
      tag.name === "delete"
    ) {
      action = tag.name;
      return;
    }
    if (tag.name === "node" && action) {
      const id = intAttr(tag, "id");
      if (id === null || id <= 0) {
        throw new Error("OSM change node is missing a valid positive id.");
      }
      node = {
        action,
        id,
        lat: numAttr(tag, "lat"),
        lon: numAttr(tag, "lon"),
        tags: {},
        info: infoFromTag(tag),
      };
      return;
    }
    if (tag.name !== "tag" || node === null) return;
    const key = attr(tag, "k");
    const value = attr(tag, "v");
    if (key && value !== undefined) node.tags[key] = value;
  };

  parser.onclosetag = (tagName) => {
    if (tagName === "node" && node !== null) {
      changes.push(node);
      node = null;
      return;
    }
    if (tagName === "create" || tagName === "modify" || tagName === "delete") {
      action = null;
    }
  };

  parser.onerror = (error) => {
    throw error;
  };

  parser.write(xml).close();
  return changes;
};
