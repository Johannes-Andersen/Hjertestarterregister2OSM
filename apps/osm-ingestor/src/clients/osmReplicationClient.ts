import { runtimeEnv } from "../config.ts";
import {
  type OsmReplicationState,
  osmMinuteReplicationSource,
} from "../repositories/osmAedRepository.ts";
import {
  formatOsmReplicationSequencePath,
  formatOsmReplicationSequenceStatePath,
  parseOsmReplicationState,
} from "../utils/osmReplication.ts";

const normalizeBaseUrl = (baseUrl: string): string =>
  baseUrl.replace(/\/+$/, "");

const fetchText = async (
  url: string,
  signal?: AbortSignal,
): Promise<string> => {
  const response = await fetch(url, {
    headers: {
      Accept: "text/plain",
      "User-Agent": runtimeEnv.OSM_USER_AGENT,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `OSM replication request failed ${response.status}: ${url}`,
    );
  }

  return await response.text();
};

const fetchBuffer = async (
  url: string,
  signal?: AbortSignal,
): Promise<Buffer> => {
  const response = await fetch(url, {
    headers: {
      Accept: "application/gzip",
      "User-Agent": runtimeEnv.OSM_USER_AGENT,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `OSM replication request failed ${response.status}: ${url}`,
    );
  }

  return Buffer.from(await response.arrayBuffer());
};

export const osmReplicationClient = {
  async getCurrentState(
    baseUrl = runtimeEnv.OSM_REPLICATION_BASE_URL,
    signal?: AbortSignal,
  ): Promise<OsmReplicationState> {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const text = await fetchText(`${normalizedBaseUrl}/state.txt`, signal);

    return parseOsmReplicationState({
      source: osmMinuteReplicationSource,
      baseUrl: normalizedBaseUrl,
      text,
    });
  },

  async getChangeFile({
    baseUrl = runtimeEnv.OSM_REPLICATION_BASE_URL,
    sequenceNumber,
    signal,
  }: {
    baseUrl?: string;
    sequenceNumber: number;
    signal?: AbortSignal;
  }): Promise<Buffer> {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const path = formatOsmReplicationSequencePath(sequenceNumber);
    return await fetchBuffer(`${normalizedBaseUrl}/${path}`, signal);
  },

  async getStateForSequence({
    baseUrl = runtimeEnv.OSM_REPLICATION_BASE_URL,
    sequenceNumber,
    signal,
  }: {
    baseUrl?: string;
    sequenceNumber: number;
    signal?: AbortSignal;
  }): Promise<OsmReplicationState> {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const path = formatOsmReplicationSequenceStatePath(sequenceNumber);
    const text = await fetchText(`${normalizedBaseUrl}/${path}`, signal);

    return parseOsmReplicationState({
      source: osmMinuteReplicationSource,
      baseUrl: normalizedBaseUrl,
      text,
    });
  },
};
