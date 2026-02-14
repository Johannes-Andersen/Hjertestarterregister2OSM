interface HjertestarterregisterApiErrorOptions {
  status?: number;
  statusText?: string;
  url?: string;
  apiError?: string;
  apiMessage?: string;
  responseBody?: unknown;
}

export class HjertestarterregisterApiError extends Error {
  readonly status?: number;
  readonly statusText?: string;
  readonly url?: string;
  readonly apiError?: string;
  readonly apiMessage?: string;
  readonly responseBody?: unknown;

  constructor(
    message: string,
    {
      status,
      statusText,
      url,
      apiError,
      apiMessage,
      responseBody,
    }: HjertestarterregisterApiErrorOptions = {},
  ) {
    super(message);
    this.name = "HjertestarterregisterApiError";
    this.status = status;
    this.statusText = statusText;
    this.url = url;
    this.apiError = apiError;
    this.apiMessage = apiMessage;
    this.responseBody = responseBody;
  }
}
