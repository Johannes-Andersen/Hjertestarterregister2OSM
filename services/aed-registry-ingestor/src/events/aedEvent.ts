import type { AedRow } from "../utils/transformAed.ts";

export const aedEventTypes = [
  "aed.created",
  "aed.updated",
  "aed.deleted",
] as const;

export type AedEventType = (typeof aedEventTypes)[number];
export type AedEventSource = "full-sync" | "incremental-sync";

export interface SerializedAed
  extends Omit<
    AedRow,
    "created_date" | "modified_date" | "active_from_date" | "active_to_date"
  > {
  created_date: string;
  modified_date: string;
  active_from_date: string | null;
  active_to_date: string | null;
}

export interface AedEventJobData {
  eventId: string;
  type: AedEventType;
  source: AedEventSource;
  occurredAt: string;
  assetId: number;
  assetGuid: string;
  aed: SerializedAed;
}

export interface AedEvent {
  eventId: string;
  type: AedEventType;
  payload: AedEventJobData;
}
