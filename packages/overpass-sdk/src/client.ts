import { Agent, type Dispatcher, fetch, Headers } from "undici";
import * as z from "zod";
import { OverpassSdkError } from "./errors.ts";
import type {
  OverpassQueryOptions,
  OverpassResponse,
  OverpassSdkClientOptions,
} from "./types.ts";

const defaultApiUrl = "https://overpass-api.de/api/interpreter";
const defaultMaxRetries = 6;
const defaultRetryDelayMs = 250;
const defaultRequestTimeoutMs = 90_000;
const defaultUserAgent = "overpass-sdk";
const timeoutErrorCodes = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
const retryableStatusCodes = new Set([429, 500, 502, 503, 504]);
const retryableTransportErrorCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ENETDOWN",
  "ENETUNREACH",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH",
]);

interface ResolvedConfiguration {
  apiUrl: string;
  maxRetries: number;
  retryDelayMs: number;
  requestTimeoutMs: number;
  userAgent: string;
}

const resolveConfiguration = (
  options: OverpassSdkClientOptions = {},
): ResolvedConfiguration => {
  return z
    .object({
      apiUrl: z
        .url({
          protocol: /^https?$/,
          hostname: z.regexes.domain,
        })
        .default(defaultApiUrl),
      maxRetries: z.int().positive().default(defaultMaxRetries),
      retryDelayMs: z.number().positive().default(defaultRetryDelayMs),
      requestTimeoutMs: z.number().positive().default(defaultRequestTimeoutMs),
      userAgent: z.string().min(3).default(defaultUserAgent),
    })
    .parse(options);
};

const createDispatcher = ({
  requestTimeoutMs,
}: Pick<ResolvedConfiguration, "requestTimeoutMs">): Dispatcher => {
  return new Agent({
    allowH2: true,
    bodyTimeout: requestTimeoutMs,
    headersTimeout: requestTimeoutMs,
  });
};

const hasCode = (error: unknown): error is Error & { code: string } =>
  error instanceof Error &&
  typeof (error as { code?: unknown }).code === "string";

const findErrorCode = (error: unknown): string | undefined => {
  let current: unknown = error;

  while (current instanceof Error) {
    if (hasCode(current)) return current.code;
    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
};

const isRetryableError = (error: unknown): boolean => {
  if (error instanceof OverpassSdkError) {
    return error.status !== undefined && retryableStatusCodes.has(error.status);
  }

  const code = findErrorCode(error);
  return code !== undefined && retryableTransportErrorCodes.has(code);
};

const waitForRetryDelay = async (
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Request aborted.", "AbortError"));
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = (): void => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Request aborted.", "AbortError"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

const toError = (
  error: unknown,
  {
    url,
    requestTimeoutMs,
    signal,
    attempts,
  }: {
    url: string;
    requestTimeoutMs: number;
    signal?: AbortSignal;
    attempts?: number;
  },
): OverpassSdkError => {
  if (error instanceof OverpassSdkError) {
    return new OverpassSdkError(error.message, {
      status: error.status,
      statusText: error.statusText,
      url: error.url ?? url,
      responseBody: error.responseBody,
      attempts: error.attempts ?? attempts,
      cause: error.cause,
    });
  }

  if (signal?.aborted) {
    return new OverpassSdkError("Overpass request was aborted.", {
      url,
      attempts,
      cause: error,
    });
  }

  const errorCode = findErrorCode(error);
  if (errorCode !== undefined && timeoutErrorCodes.has(errorCode)) {
    return new OverpassSdkError(
      `Overpass request timed out after ${requestTimeoutMs}ms.`,
      {
        url,
        attempts,
        cause: error,
      },
    );
  }

  if (error instanceof Error) {
    return new OverpassSdkError(error.message, {
      url,
      attempts,
      cause: error,
    });
  }

  return new OverpassSdkError("Overpass request failed.", {
    url,
    attempts,
    cause: error,
  });
};

export class OverpassApiClient {
  private readonly dispatcher: Dispatcher;
  private readonly configuration: ResolvedConfiguration;

  constructor(options: OverpassSdkClientOptions = {}) {
    this.configuration = resolveConfiguration(options);
    this.dispatcher = createDispatcher({
      requestTimeoutMs: this.configuration.requestTimeoutMs,
    });
  }

  getConfig(): Readonly<ResolvedConfiguration> {
    return { ...this.configuration };
  }

  async query<TResponse = OverpassResponse>(
    queryText: string,
    options: OverpassQueryOptions = {},
  ): Promise<TResponse> {
    const normalizedQuery = queryText.trim();
    if (!normalizedQuery) {
      throw new OverpassSdkError("Overpass query must be a non-empty string.");
    }

    const url = new URL(this.configuration.apiUrl);
    const requestUrl = url.toString();
    const requestBody = new URLSearchParams({
      data: normalizedQuery,
    }).toString();
    const maxAttempts = this.configuration.maxRetries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const requestHeaders = new Headers(options.headers ?? {});
        if (!requestHeaders.has("Accept")) {
          requestHeaders.set("Accept", "application/json");
        }
        if (!requestHeaders.has("Content-Type")) {
          requestHeaders.set(
            "Content-Type",
            "application/x-www-form-urlencoded",
          );
        }
        if (!requestHeaders.has("User-Agent"))
          requestHeaders.set("User-Agent", this.configuration.userAgent);

        const response = await fetch(requestUrl, {
          method: "POST",
          headers: requestHeaders,
          body: requestBody,
          signal: options.signal,
          dispatcher: this.dispatcher,
        });

        const text = await response.text();

        let payload: unknown;
        if (text.trim()) {
          try {
            payload = JSON.parse(text) as unknown;
          } catch {
            if (response.ok) {
              throw new OverpassSdkError(
                "Overpass response body was not valid JSON.",
                {
                  status: response.status,
                  statusText: response.statusText,
                  url: requestUrl,
                  responseBody: text,
                  attempts: attempt,
                },
              );
            }

            payload = text;
          }
        } else {
          payload = {};
        }

        if (!response.ok) {
          throw new OverpassSdkError(
            `Overpass request failed with status ${response.status}.`,
            {
              status: response.status,
              statusText: response.statusText,
              url: requestUrl,
              responseBody: payload,
              attempts: attempt,
            },
          );
        }

        return payload as TResponse;
      } catch (error) {
        if (options.signal?.aborted) {
          throw toError(error, {
            url: requestUrl,
            requestTimeoutMs: this.configuration.requestTimeoutMs,
            signal: options.signal,
            attempts: attempt,
          });
        }

        if (attempt >= maxAttempts || !isRetryableError(error)) {
          throw toError(error, {
            url: requestUrl,
            requestTimeoutMs: this.configuration.requestTimeoutMs,
            signal: options.signal,
            attempts: attempt,
          });
        }

        try {
          await waitForRetryDelay(
            this.configuration.retryDelayMs,
            options.signal,
          );
        } catch (waitError) {
          throw toError(waitError, {
            url: requestUrl,
            requestTimeoutMs: this.configuration.requestTimeoutMs,
            signal: options.signal,
            attempts: attempt,
          });
        }
      }
    }

    throw new OverpassSdkError("Overpass request failed after retries.", {
      url: requestUrl,
      attempts: maxAttempts,
    });
  }
}
