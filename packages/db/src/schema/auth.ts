import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { academies } from './tenancy';
import { users } from './users';
import { createdAt, id, nullableIso } from './_shared';

/**
 * Refresh-token sessions. Access tokens stay stateless (15 min); refresh
 * tokens are opaque random strings whose SHA-256 is stored here, so a stolen
 * database cannot be replayed and an admin can revoke a lost device.
 */
export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    expiresAt: text('expires_at').notNull(),
    revokedAt: nullableIso('revoked_at'),
    lastUsedAt: nullableIso('last_used_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('auth_sessions_user_idx').on(t.userId, t.revokedAt),
    index('auth_sessions_expiry_idx').on(t.expiresAt),
  ],
);
