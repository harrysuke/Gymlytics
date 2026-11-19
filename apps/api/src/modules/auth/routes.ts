import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  academies,
  authSessions,
  familyLinks,
  users,
  type Db,
} from '@gymlytics/db';
import {
  deviceSessionSchema,
  loginSchema,
  refreshSchema,
  type AuthUser,
} from '@gymlytics/shared';
import { auth, authenticate } from '../../lib/auth';
import { parseJsonBody, randomToken, sha256Hex, signJwt, verifyPassword } from '../../lib/crypto';
import { env } from '../../lib/env';
import { forbidden, unauthorized } from '../../lib/errors';

const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['*'],
  admin: ['*'],
  coach: ['classes:read', 'classes:write', 'attendance:write', 'promotions:write', 'members:read'],
  staff: ['members:read', 'members:write', 'attendance:write', 'billing:write', 'waivers:write'],
  student: ['self:read', 'self:book'],
  guardian: ['family:read', 'family:book', 'family:sign'],
  dropin: ['self:read'],
};

function toAuthUser(user: typeof users.$inferSelect): AuthUser {
  return {
    id: user.id,
    academyId: user.academyId,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    permissions: ROLE_PERMISSIONS[user.role] ?? [],
  };
}

export async function registerAuthRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.post('/v1/auth/login', async (request) => {
    const body = await parseJsonBody(request, loginSchema);
    const academy = db
      .select()
      .from(academies)
      .where(and(eq(academies.slug, body.academySlug), isNull(academies.deletedAt)))
      .get();
    if (!academy) throw unauthorized('Academy or credentials not recognised');

    const user = db
      .select()
      .from(users)
      .where(
        and(
          eq(users.academyId, academy.id),
          eq(users.email, body.email.toLowerCase()),
          isNull(users.deletedAt),
        ),
      )
      .get();
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      throw unauthorized('Academy or credentials not recognised');
    }
    if (user.status === 'inactive') throw forbidden('This account is inactive');

    const tokens = issueSession(db, user, request.headers['user-agent'], request.ip);
    db.update(users).set({ lastLoginAt: new Date().toISOString() }).where(eq(users.id, user.id)).run();

    return {
      ok: true,
      data: {
        ...tokens,
        user: toAuthUser(user),
        academy: { id: academy.id, name: academy.name, slug: academy.slug, currency: academy.currency },
      },
    };
  });

  app.post('/v1/auth/refresh', async (request) => {
    const body = await parseJsonBody(request, refreshSchema);
    const tokenHash = sha256Hex(body.refreshToken);
    const session = db.select().from(authSessions).where(eq(authSessions.refreshTokenHash, tokenHash)).get();
    if (!session || session.revokedAt || new Date(session.expiresAt) <= new Date()) {
      throw unauthorized('Refresh token is invalid or expired');
    }
    const user = db.select().from(users).where(eq(users.id, session.userId)).get();
    if (!user || user.status === 'inactive') throw unauthorized();

    db.update(authSessions)
      .set({ revokedAt: new Date().toISOString(), lastUsedAt: new Date().toISOString() })
      .where(eq(authSessions.id, session.id))
      .run();

    const tokens = issueSession(db, user, request.headers['user-agent'], request.ip);
    return { ok: true, data: { ...tokens, user: toAuthUser(user) } };
  });

  app.post('/v1/auth/logout', { preHandler: authenticate }, async (request) => {
    const body = (request.body ?? {}) as { refreshToken?: string };
    if (body.refreshToken) {
      db.update(authSessions)
        .set({ revokedAt: new Date().toISOString() })
        .where(eq(authSessions.refreshTokenHash, sha256Hex(body.refreshToken)))
        .run();
    }
    return { ok: true, data: { loggedOut: true } };
  });

  /**
   * Kiosk / waiver-tablet session. The device key is a deployment secret, not
   * a user password; it mints a token scoped to one academy and one device id.
   */
  app.post('/v1/auth/device', async (request) => {
    const body = await parseJsonBody(request, deviceSessionSchema);
    const academy = db
      .select()
      .from(academies)
      .where(and(eq(academies.slug, body.academySlug), isNull(academies.deletedAt)))
      .get();
    if (!academy) throw unauthorized('Academy not found');
    if (body.deviceKey !== env.kioskDeviceKey) throw unauthorized('Invalid device key');

    const accessToken = signJwt(
      {
        sub: `device:${body.deviceId}`,
        aid: academy.id,
        role: 'kiosk',
        typ: 'device',
        deviceId: body.deviceId,
      },
      env.jwtSecret,
      env.deviceTokenTtlSeconds,
    );
    return {
      ok: true,
      data: {
        accessToken,
        deviceId: body.deviceId,
        academy: { id: academy.id, name: academy.name, slug: academy.slug, currency: academy.currency },
      },
    };
  });

  app.get('/v1/auth/me', { preHandler: authenticate }, async (request) => {
    const context = auth(request);
    const user = db.select().from(users).where(eq(users.id, context.userId)).get();
    if (!user) throw unauthorized();
    const academy = db.select().from(academies).where(eq(academies.id, user.academyId)).get();

    const dependents = db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        dateOfBirth: users.dateOfBirth,
        canBookClasses: familyLinks.canBookClasses,
        canSignWaivers: familyLinks.canSignWaivers,
      })
      .from(familyLinks)
      .innerJoin(users, eq(familyLinks.dependentId, users.id))
      .where(eq(familyLinks.guardianId, user.id))
      .all();

    return {
      ok: true,
      data: {
        user: toAuthUser(user),
        academy: academy
          ? { id: academy.id, name: academy.name, slug: academy.slug, currency: academy.currency, timezone: academy.timezone }
          : null,
        dependents,
      },
    };
  });
}

function issueSession(
  db: Db,
  user: typeof users.$inferSelect,
  userAgent: string | undefined,
  ip: string | undefined,
): { accessToken: string; refreshToken: string; expiresIn: number } {
  const refreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 86_400_000).toISOString();

  db.insert(authSessions)
    .values({
      academyId: user.academyId,
      userId: user.id,
      refreshTokenHash: sha256Hex(refreshToken),
      userAgent: userAgent?.slice(0, 300) ?? null,
      ipAddress: ip ?? null,
      expiresAt,
    })
    .run();

  const accessToken = signJwt(
    {
      sub: user.id,
      aid: user.academyId,
      role: user.role,
      typ: 'access',
      name: `${user.firstName} ${user.lastName}`,
    },
    env.jwtSecret,
    env.accessTokenTtlSeconds,
  );

  return { accessToken, refreshToken, expiresIn: env.accessTokenTtlSeconds };
}
