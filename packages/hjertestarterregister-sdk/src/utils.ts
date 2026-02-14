import type { QueryParams, QueryValue, RequestBody } from "./types.ts";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const normalizeBoolean = (value: unknown): unknown =>
  typeof value === "boolean" ? (value ? "Y" : "N") : value;

export const normalizeRequestBody = (
  body: RequestBody,
): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    normalized[key] = normalizeBoolean(value);
  }
  return normalized;
};

export const applyQuery = (url: URL, query?: QueryParams) => {
  if (!query) return;
  for (const [key, value] of Object.entries(
    query as Record<string, QueryValue>,
  )) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
};

export const getGuidSegment = (guid: string): string => {
  const value = guid.trim();
  if (!value) throw new Error("GUID must be a non-empty string.");
  return encodeURIComponent(value);
};

interface ParsedApiMessage {
  apiError?: string;
  apiMessage?: string;
  oauthError?: string;
  oauthDescription?: string;
}

export const parseApiMessage = (payload: unknown): ParsedApiMessage => {
  if (!isRecord(payload)) return {};
  return {
    apiError:
      typeof payload.API_ERROR === "string" ? payload.API_ERROR : undefined,
    apiMessage:
      typeof payload.API_MESSAGE === "string" ? payload.API_MESSAGE : undefined,
    oauthError: typeof payload.error === "string" ? payload.error : undefined,
    oauthDescription:
      typeof payload.error_description === "string"
        ? payload.error_description
        : undefined,
  };
};

export const getErrorMessage = (
  parsedMessage: ParsedApiMessage,
  fallback: string,
): string =>
  parsedMessage.apiError ??
  parsedMessage.oauthDescription ??
  parsedMessage.oauthError ??
  parsedMessage.apiMessage ??
  fallback;
