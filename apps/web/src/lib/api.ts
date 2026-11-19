/**
 * Typed API client.
 *
 * Every response from the server is `{ ok, data, meta? }`. This module unwraps
 * that envelope once, so views deal in domain objects and never see `ok`.
 *
 * Auth: the access token is short-lived (15 min) and the refresh token is
 * single-use and rotated. On a 401 we transparently refresh once and replay the
 * request; if that fails the session is cleared and the caller gets a 401.
 */
/**
 * Empty means "same origin": in dev, Vite proxies `/v1` to the API, so no
 * CORS preflight is involved and the app works from any host that serves the
 * dev server. Set VITE_API_URL only when the API is genuinely remote.
 */
export const API_URL: string = import.meta.env.VITE_API_URL ?? '';

const ACCESS_KEY = 'gymlytics.access';
const REFRESH_KEY = 'gymlytics.refresh';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Pagination {
  total: number;
  limit: number;
}

export interface Page<T> {
  data: T;
  pagination?: Pagination;
}

let accessToken: string | null = localStorage.getItem(ACCESS_KEY);
let refreshToken: string | null = localStorage.getItem(REFRESH_KEY);
let refreshing: Promise<boolean> | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setTokens(access: string, refresh: string): void {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function hasStoredSession(): boolean {
  return Boolean(accessToken || refreshToken);
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

type Query = Record<string, string | number | boolean | undefined | null>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

interface RequestOptions {
  body?: unknown;
  query?: Query;
  /** Skip the Authorization header and the refresh dance (login, refresh). */
  anonymous?: boolean;
  /** Set to false for endpoints that legitimately return 401 to anonymous users. */
  retryOn401?: boolean;
  signal?: AbortSignal;
  /** Override the bearer token (the kiosk uses its own device token store). */
  token?: string | null;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  meta?: { pagination?: Pagination };
  error?: { code: string; message: string; details?: unknown };
}

async function rawRequest<T>(
  method: string,
  path: string,
  options: RequestOptions,
): Promise<{ body: Envelope<T>; status: number }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const bearer = options.token === undefined ? accessToken : options.token;
  if (!options.anonymous && bearer) headers.Authorization = `Bearer ${bearer}`;

  const response = await fetch(`${API_URL}${withQuery(path, options.query)}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const text = await response.text();
  let body: Envelope<T>;
  try {
    body = text ? (JSON.parse(text) as Envelope<T>) : { ok: response.ok };
  } catch {
    throw new ApiError(response.status, 'invalid_response', text.slice(0, 200) || 'Malformed response');
  }
  return { body, status: response.status };
}

/** Exchange the refresh token for a new pair. Deduplicated across callers. */
async function refreshSession(): Promise<boolean> {
  if (!refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const { body, status } = await rawRequest<{
        accessToken: string;
        refreshToken: string;
      }>('POST', '/v1/auth/refresh', {
        body: { refreshToken },
        anonymous: true,
      });
      if (status !== 200 || !body.data) {
        clearTokens();
        return false;
      }
      setTokens(body.data.accessToken, body.data.refreshToken);
      return true;
    } catch {
      clearTokens();
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<Page<T>> {
  let { body, status } = await rawRequest<T>(method, path, options);

  if (status === 401 && !options.anonymous && options.retryOn401 !== false) {
    if (await refreshSession()) {
      ({ body, status } = await rawRequest<T>(method, path, options));
    }
  }

  if (status >= 400 || body.ok === false) {
    const error = body.error;
    throw new ApiError(
      status,
      error?.code ?? 'request_failed',
      error?.message ?? `Request failed (${status})`,
      error?.details,
    );
  }

  return { data: (body.data ?? (body as unknown as T)) as T, ...(body.meta?.pagination ? { pagination: body.meta.pagination } : {}) };
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => request<T>('GET', path, options ?? {}),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('PATCH', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('PUT', path, { ...options, body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => request<T>('DELETE', path, options ?? {}),
};

/** Absolute URL for things the browser must fetch directly (PDF, downloads). */
export function assetUrl(path: string): string {
  return `${API_URL}${path}`;
}

/** Fetch a binary asset with the bearer token and return an object URL. */
export async function fetchBlobUrl(path: string, token?: string | null): Promise<string> {
  const bearer = token === undefined ? accessToken : token;
  const response = await fetch(`${API_URL}${path}`, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
  });
  if (!response.ok) throw new ApiError(response.status, 'blob_failed', 'Could not load document');
  return URL.createObjectURL(await response.blob());
}
