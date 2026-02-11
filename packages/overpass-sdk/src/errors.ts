interface OverpassSdkErrorOptions {
  status?: number;
  statusText?: string;
  url?: string;
  responseBody?: unknown;
  attempts?: number;
  cause?: unknown;
}

export class OverpassSdkError extends Error {
  readonly status?: number;
  readonly statusText?: string;
  readonly url?: string;
  readonly responseBody?: unknown;
  readonly attempts?: number;

  constructor(message: string, options: OverpassSdkErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "OverpassSdkError";
    this.status = options.status;
    this.statusText = options.statusText;
    this.url = options.url;
    this.responseBody = options.responseBody;
    this.attempts = options.attempts;
  }
}
