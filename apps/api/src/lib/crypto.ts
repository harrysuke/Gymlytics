import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Kiosk PINs are convenience credentials, not account passwords: 4-8 digits
 * can never be strong. They are scoped per academy and salted with the
 * academy id so the same PIN on two gyms does not produce the same hash.
 * The kiosk computes this exact digest locally for offline lookup.
 */
export function hashPin(academyId: string, pin: string): string {
  return sha256Hex(`${academyId}:${pin}`);
}

/** scrypt password hashing with a per-user salt, stored as scrypt$salt$hash. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface AccessTokenPayload {
  sub: string;
  aid: string;
  role: string;
  typ: 'access' | 'device';
  name?: string;
  deviceId?: string;
  iat: number;
  exp: number;
}

export function signJwt(payload: Omit<AccessTokenPayload, 'iat' | 'exp'>, secret: string, ttlSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyJwt(token: string, secret: string): AccessTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  if (!header || !body || !signature) return null;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccessTokenPayload;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function parseJsonBody<T>(request: FastifyRequest, schema: ZodType<T>): Promise<T> {
  const raw = request.body;
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return schema.parse(value);
}

export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}
