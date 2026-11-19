import { API_URL } from './config';

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

export interface ApiInit {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  token?: string | null;
  anonymous?: boolean;
  signal?: AbortSignal;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  meta?: unknown;
  error?: { code: string; message: string; details?: unknown };
}

function withQuery(path: string, query?: ApiInit['query']): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Single request helper for the app.
 *
 * Expo runs on a phone: a dropped connection is normal, so network failures are
 * surfaced as `ApiError(0, 'network', ...)` and every screen renders that as a
 * retryable state rather than a crash.
 */
export async function apiFetch<T>(path: string, init: ApiInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!init.anonymous && init.token) headers.Authorization = `Bearer ${init.token}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${withQuery(path, init.query)}`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch (error) {
    throw new ApiError(0, 'network', error instanceof Error ? error.message : 'Network unavailable');
  }

  const text = await response.text();
  let body: Envelope<T>;
  try {
    body = text ? (JSON.parse(text) as Envelope<T>) : { ok: response.ok };
  } catch {
    throw new ApiError(response.status, 'invalid_response', 'Malformed response from server');
  }

  if (response.status >= 400 || body.ok === false) {
    throw new ApiError(
      response.status,
      body.error?.code ?? 'request_failed',
      body.error?.message ?? `Request failed (${response.status})`,
      body.error?.details,
    );
  }
  return (body.data ?? (body as unknown as T)) as T;
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'network') return 'No connection — check your network and try again.';
    const details = error.details as { issues?: { path: (string | number)[]; message: string }[] } | undefined;
    const first = details?.issues?.[0];
    if (first) return `${first.path.join('.') || 'request'}: ${first.message}`;
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}
