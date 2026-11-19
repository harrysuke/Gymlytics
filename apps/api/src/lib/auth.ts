import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from './env';
import { unauthorized, forbidden } from './errors';
import { bearerToken, verifyJwt } from './crypto';

export interface AuthContext {
  userId: string;
  academyId: string;
  role: string;
  tokenType: 'access' | 'device';
  deviceId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  // Idempotent: the app-wide preHandler runs first, and `requireRole` calls this
  // again for routes that only declare a role guard.
  if (request.auth) return;
  const token = bearerToken(request);
  if (!token) throw unauthorized();
  const payload = verifyJwt(token, env.jwtSecret);
  if (!payload) throw unauthorized('Session expired or invalid');
  request.auth = {
    userId: payload.sub,
    academyId: payload.aid,
    role: payload.role,
    tokenType: payload.typ,
    ...(payload.deviceId ? { deviceId: payload.deviceId } : {}),
  };
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    const role = request.auth?.role;
    if (!role || !roles.includes(role)) throw forbidden();
  };
}

export function auth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

/** Tenant boundary: never trust an academy id supplied in the body. */
export function assertTenant(request: FastifyRequest, academyId: string): void {
  if (auth(request).academyId !== academyId) throw forbidden('Cross-academy access denied');
}
