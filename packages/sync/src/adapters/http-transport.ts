import type { SyncMutation, SyncPullResult, SyncPushResult } from '@gymlytics/shared';
import type { SyncTransport } from '../types';

/** fetch-based transport. Inject a token getter so the engine stays auth-agnostic. */
export class HttpSyncTransport implements SyncTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => Promise<string | null> = async () => null,
  ) {}

  async push(
    academyId: string,
    deviceId: string,
    mutations: SyncMutation[],
    signal?: AbortSignal,
  ): Promise<SyncPushResult> {
    return this.request<SyncPushResult>(
      '/v1/sync/push',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Academy-Id': academyId,
          'X-Device-Id': deviceId,
          'Idempotency-Key': mutations[0]?.mutationId ?? crypto.randomUUID(),
        },
        body: JSON.stringify({ mutations }),
      },
      signal,
      academyId,
      deviceId,
    );
  }

  async pull(
    academyId: string,
    deviceId: string,
    since: string,
    signal?: AbortSignal,
  ): Promise<SyncPullResult> {
    const query = new URLSearchParams({ deviceId, since });
    return this.request<SyncPullResult>(
      `/v1/sync/pull?${query.toString()}`,
      { method: 'GET' },
      signal,
      academyId,
      deviceId,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    academyId: string,
    deviceId: string,
  ): Promise<T> {
    const token = await this.getToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal,
      headers: {
        Accept: 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
        'X-Academy-Id': academyId,
        'X-Device-Id': deviceId,
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Sync ${init.method ?? 'GET'} ${path} failed (${response.status}): ${body.slice(0, 300)}`);
    }

    // The API wraps every payload in `{ ok, data }`. Tolerate both shapes so a
    // transport pointed at an older deployment (raw body) keeps working.
    const payload = (await response.json()) as { ok?: boolean; data?: unknown } & Record<string, unknown>;
    if (payload && payload.ok === false) {
      throw new Error(`Sync ${init.method ?? 'GET'} ${path} rejected: ${JSON.stringify(payload).slice(0, 300)}`);
    }
    return (payload && 'data' in payload && payload.data !== undefined ? payload.data : payload) as T;
  }
}
