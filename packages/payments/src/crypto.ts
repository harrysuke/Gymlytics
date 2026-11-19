import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function hmacHex(algorithm: 'sha256' | 'sha512', secret: string, payload: string): string {
  return createHmac(algorithm, secret).update(payload, 'utf8').digest('hex');
}

export function hashHex(algorithm: 'md5' | 'sha256', payload: string): string {
  return createHash(algorithm).update(payload, 'utf8').digest('hex');
}

/** Constant-time comparison — never short-circuit on provider signatures. */
export function safeEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function basicAuth(username: string, password = ''): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

export function toForm(data: Record<string, string | number | boolean | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params;
}
