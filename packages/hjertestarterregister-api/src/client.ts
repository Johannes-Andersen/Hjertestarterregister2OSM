import {
  Agent,
  type Dispatcher,
  fetch,
  Headers,
  type Response,
  RetryAgent,
} from "undici";
import { HjertestarterregisterApiError } from "./errors.ts";
import type {
  ApiMessageResponse,
  ApiSuccessResponse,
  AssetListResponse,
  AssetMutationResponse,
  AssetUpsertPayload,
  CreateMessagePayload,
  HjertestarterregisterApiClientOptions,
  OAuthAccessTokenResponse,
  SearchAssetsParams,
  SinceDateParams,
} from "./types.ts";

const defaultApiBaseUrl = "https://hjertestarterregister.113.no/ords/api/v1/";
const defaultOAuthTokenUrl =
  "https://hjertestarterregister.113.no/ords/api/oauth/token";
const defaultMaxRetries = 3;
const tokenSafetyWindowMs = 60_000;
const retryableMethods: Dispatcher.HttpMethod[] = [
  "GET",
  "HEAD",
  "OPTIONS",
  "PUT",
  "DELETE",
];
const retryableStatusCodes = [429, 500, 502, 503, 504];

type QueryValue = string | number | boolean | undefined | null;
type QueryParams =
  | SearchAssetsParams
  | SinceDateParams
  | Record<string, QueryValue>;
type RequestBody =
  | AssetUpsertPayload
  | CreateMessagePayload
  | Record<string, unknown>;

interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: QueryParams;
  body?: RequestBody;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeBaseUrl = (baseUrl: string): string =>
  baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

const normalizePath = (path: string): string =>
  path.startsWith("/") ? path.slice(1) : path;

const normalizeBoolean = (value: unknown): unknown =>
  typeof value === "boolean" ? (value ? "Y" : "N") : value;

const normalizeRequestBody = (body: RequestBody): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    normalized[key] = normalizeBoolean(value);
  }

  return normalized;
};

const applyQuery = (url: URL, query?: QueryParams) => {
  if (!query) return;

  for (const [key, value] of Object.entries(
    query as Record<string, QueryValue>,
  )) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
};

const getGuidSegment = (guid: string): string => {
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

const parseApiMessage = (payload: unknown): ParsedApiMessage => {
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

const getErrorMessage = (
  parsedMessage: ParsedApiMessage,
  fallback: string,
): string =>
  parsedMessage.apiError ??
  parsedMessage.oauthDescription ??
  parsedMessage.oauthError ??
  parsedMessage.apiMessage ??
  fallback;

const createDispatcher = (): Dispatcher => {
  const agent = new Agent({
    allowH2: true,
  });

  return new RetryAgent(agent, {
    throwOnError: false,
    maxRetries: defaultMaxRetries,
    methods: retryableMethods,
    statusCodes: retryableStatusCodes,
  });
};

export class HjertestarterregisterApiClient {
  readonly baseUrl: string;
  readonly oauthTokenUrl: string;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly dispatcher: Dispatcher;

  private cachedToken?: string;
  private cachedTokenExpiresAtMs?: number;
  private pendingTokenPromise?: Promise<string>;

  constructor(options: HjertestarterregisterApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? defaultApiBaseUrl);
    this.oauthTokenUrl = options.oauthTokenUrl ?? defaultOAuthTokenUrl;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.dispatcher = createDispatcher();
  }

  async searchAssets(
    params: SearchAssetsParams = {},
  ): Promise<AssetListResponse> {
    return this.request<AssetListResponse>({
      method: "GET",
      path: "assets/search/",
      query: params,
    });
  }

  async searchDeletedAssets(
    params: SinceDateParams = {},
  ): Promise<AssetListResponse> {
    return this.request<AssetListResponse>({
      method: "GET",
      path: "assets/deleted/",
      query: params,
    });
  }

  async searchInactiveAssets(
    params: SinceDateParams = {},
  ): Promise<AssetListResponse> {
    return this.request<AssetListResponse>({
      method: "GET",
      path: "assets/inactive/",
      query: params,
    });
  }

  async getMyAssets(): Promise<AssetListResponse> {
    return this.request<AssetListResponse>({
      method: "GET",
      path: "assets/",
    });
  }

  async getAsset(guid: string): Promise<AssetListResponse> {
    return this.request<AssetListResponse>({
      method: "GET",
      path: `assets/${getGuidSegment(guid)}`,
    });
  }

  async activateAsset(
    guid: string,
    body: Record<string, unknown> = { dummy: 42 },
  ): Promise<ApiMessageResponse> {
    return this.request<ApiMessageResponse>({
      method: "PUT",
      path: `assets/${getGuidSegment(guid)}/active`,
      body,
    });
  }

  async deactivateAsset(
    guid: string,
    body: Record<string, unknown> = { dummy: 42 },
  ): Promise<ApiMessageResponse> {
    return this.request<ApiMessageResponse>({
      method: "PUT",
      path: `assets/${getGuidSegment(guid)}/inactive`,
      body,
    });
  }

  async deleteAsset(
    guid: string,
    body: Record<string, unknown> = { dummy: 42 },
  ): Promise<AssetMutationResponse> {
    return this.request<AssetMutationResponse>({
      method: "DELETE",
      path: `assets/${getGuidSegment(guid)}`,
      body,
    });
  }

  async createAsset(
    payload: AssetUpsertPayload,
  ): Promise<AssetMutationResponse> {
    return this.request<AssetMutationResponse>({
      method: "POST",
      path: "assets/",
      body: payload,
    });
  }

  async updateAsset(
    guid: string,
    payload: AssetUpsertPayload,
  ): Promise<AssetMutationResponse> {
    return this.request<AssetMutationResponse>({
      method: "PUT",
      path: `assets/${getGuidSegment(guid)}`,
      body: payload,
    });
  }

  async createMessage(
    guid: string,
    payload: CreateMessagePayload,
  ): Promise<AssetMutationResponse> {
    return this.request<AssetMutationResponse>({
      method: "POST",
      path: `assets/${getGuidSegment(guid)}/message`,
      body: payload,
    });
  }

  private async request<TResponse extends ApiSuccessResponse>({
    method,
    path,
    query,
    body,
  }: RequestOptions): Promise<TResponse> {
    const url = new URL(normalizePath(path), this.baseUrl);
    applyQuery(url, query);

    const bearerToken = await this.getAccessToken();
    const headers = new Headers();
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${bearerToken}`);

    let requestBody: string | undefined;
    if (body) {
      headers.set("Content-Type", "application/json");
      requestBody = JSON.stringify(normalizeRequestBody(body));
    }

    const response = await fetch(url, {
      method,
      headers,
      body: requestBody,
      dispatcher: this.dispatcher,
    });

    const payload = await this.parseJsonResponse(response);
    const parsedMessage = parseApiMessage(payload);

    if (!response.ok) {
      throw new HjertestarterregisterApiError(
        getErrorMessage(
          parsedMessage,
          `Request failed with status ${response.status}.`,
        ),
        {
          status: response.status,
          statusText: response.statusText,
          url: url.toString(),
          apiError: parsedMessage.apiError,
          apiMessage: parsedMessage.apiMessage,
          responseBody: payload,
        },
      );
    }

    if (parsedMessage.apiError) {
      throw new HjertestarterregisterApiError(
        getErrorMessage(parsedMessage, "API returned an error payload."),
        {
          status: response.status,
          statusText: response.statusText,
          url: url.toString(),
          apiError: parsedMessage.apiError,
          apiMessage: parsedMessage.apiMessage,
          responseBody: payload,
        },
      );
    }

    if (!isRecord(payload)) {
      throw new HjertestarterregisterApiError(
        "API returned a non-object JSON payload.",
        {
          status: response.status,
          statusText: response.statusText,
          url: url.toString(),
          responseBody: payload,
        },
      );
    }

    console.log(`Successful ${method} request to ${url.pathname}`);

    return payload as TResponse;
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.cachedToken &&
      this.cachedTokenExpiresAtMs !== undefined &&
      Date.now() < this.cachedTokenExpiresAtMs - tokenSafetyWindowMs
    ) {
      return this.cachedToken;
    }

    if (this.pendingTokenPromise) return this.pendingTokenPromise;

    this.pendingTokenPromise = this.requestAccessToken()
      .then((tokenResponse) => {
        this.cachedToken = tokenResponse.access_token;
        this.cachedTokenExpiresAtMs =
          Date.now() + tokenResponse.expires_in * 1000;
        return tokenResponse.access_token;
      })
      .finally(() => {
        this.pendingTokenPromise = undefined;
      });

    return this.pendingTokenPromise;
  }

  private async requestAccessToken(): Promise<OAuthAccessTokenResponse> {
    if (!this.clientId || !this.clientSecret)
      throw new Error(
        "Missing credentials. Provide either accessToken or clientId and clientSecret.",
      );

    const authorization = `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`;
    const response = await fetch(this.oauthTokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
      dispatcher: this.dispatcher,
    });

    const payload = await this.parseJsonResponse(response);
    const parsedMessage = parseApiMessage(payload);

    if (!response.ok) {
      throw new HjertestarterregisterApiError(
        getErrorMessage(
          parsedMessage,
          `OAuth token request failed with status ${response.status}.`,
        ),
        {
          status: response.status,
          statusText: response.statusText,
          url: this.oauthTokenUrl,
          apiError: parsedMessage.apiError,
          apiMessage: parsedMessage.apiMessage,
          responseBody: payload,
        },
      );
    }

    if (
      !isRecord(payload) ||
      typeof payload.access_token !== "string" ||
      typeof payload.token_type !== "string" ||
      typeof payload.expires_in !== "number"
    ) {
      throw new HjertestarterregisterApiError(
        "OAuth token response did not match expected structure.",
        {
          status: response.status,
          statusText: response.statusText,
          url: this.oauthTokenUrl,
          responseBody: payload,
        },
      );
    }

    return {
      access_token: payload.access_token,
      token_type: payload.token_type,
      expires_in: payload.expires_in,
    };
  }

  private async parseJsonResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text.trim()) return {};

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new HjertestarterregisterApiError(
        "Response body was not valid JSON.",
        {
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          responseBody: text,
        },
      );
    }
  }
}
