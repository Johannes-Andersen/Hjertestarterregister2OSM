import type { OsmReplicationState } from "../repositories/osmAedRepository.ts";

export const formatOsmReplicationSequencePath = (
  sequenceNumber: number,
): string => {
  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 0) {
    throw new Error(`Invalid OSM replication sequence: ${sequenceNumber}`);
  }

  const padded = String(sequenceNumber).padStart(9, "0");
  return `${padded.slice(0, 3)}/${padded.slice(3, 6)}/${padded.slice(6)}.osc.gz`;
};

export const formatOsmReplicationSequenceStatePath = (
  sequenceNumber: number,
): string =>
  formatOsmReplicationSequencePath(sequenceNumber).replace(
    /\.osc\.gz$/,
    ".state.txt",
  );

export const parseOsmReplicationState = ({
  source,
  baseUrl,
  text,
}: {
  source: string;
  baseUrl: string;
  text: string;
}): OsmReplicationState => {
  const values = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    values.set(
      trimmed.slice(0, separatorIndex),
      trimmed.slice(separatorIndex + 1).replaceAll("\\:", ":"),
    );
  }

  const sequenceNumber = Number(values.get("sequenceNumber"));
  if (!Number.isInteger(sequenceNumber) || sequenceNumber < 0) {
    throw new Error("OSM replication state is missing sequenceNumber.");
  }

  const timestampValue = values.get("timestamp");
  if (!timestampValue) {
    throw new Error("OSM replication state is missing timestamp.");
  }

  const timestamp = new Date(timestampValue);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid OSM replication timestamp: ${timestampValue}`);
  }

  return {
    source,
    sequence_number: sequenceNumber,
    timestamp,
    base_url: baseUrl,
  };
};
