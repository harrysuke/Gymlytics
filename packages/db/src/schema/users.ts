import { index, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { academies } from './tenancy';
import { createdAt, deletedAt, flag, id, nullableIso, updatedAt } from './_shared';

export const USER_ROLES = [
  'owner',
  'admin',
  'coach',
  'staff',
  'student',
  'guardian',
  'dropin',
] as const;

export const USER_STATUS = ['active', 'inactive', 'frozen', 'pending_waiver'] as const;

/**
 * One row per human. Children and drop-ins are legitimate users with no email
 * and no password — they authenticate via guardian link, PIN, or QR token.
 */
export const users = sqliteTable(
  'users',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    role: text('role', { enum: USER_ROLES }).notNull().default('student'),
    status: text('status', { enum: USER_STATUS }).notNull().default('active'),

    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    preferredName: text('preferred_name'),
    email: text('email'),
    phone: text('phone'),

    // Never store raw PINs or cards. pinHash = HMAC(secret, pin) for kiosk lookup.
    passwordHash: text('password_hash'),
    pinHash: text('pin_hash'),
    qrToken: text('qr_token').unique(),

    dateOfBirth: text('date_of_birth'),
    gender: text('gender', { enum: ['male', 'female', 'other', 'undisclosed'] }),
    avatarUrl: text('avatar_url'),

    addressLine1: text('address_line1'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    medicalNotes: text('medical_notes'),

    emailVerifiedAt: nullableIso('email_verified_at'),
    lastLoginAt: nullableIso('last_login_at'),
    notes: text('notes'),

    // Acquisition attribution for members who came in without a lead record.
    // Values match LEAD_SOURCES; the self-reference is typed explicitly to
    // avoid circular inference on this table's own definition.
    acquisitionSource: text('acquisition_source'),
    referredByUserId: text('referred_by_user_id').references(
      (): AnySQLiteColumn => users.id,
      { onDelete: 'set null' },
    ),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('users_academy_email_uq').on(t.academyId, t.email),
    index('users_academy_status_idx').on(t.academyId, t.status),
    index('users_academy_name_idx').on(t.academyId, t.lastName, t.firstName),
  ],
);

export const FAMILY_RELATIONSHIPS = [
  'parent',
  'guardian',
  'spouse',
  'sibling',
  'child',
  'other',
] as const;

/**
 * Guardian -> dependent graph. A parent can manage billing and sign waivers
 * for N children; a child can have 2 guardians. Permissions are per-link so
 * a non-custodial guardian can view progress but not change billing.
 */
export const familyLinks = sqliteTable(
  'family_links',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    guardianId: text('guardian_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dependentId: text('dependent_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    relationship: text('relationship', { enum: FAMILY_RELATIONSHIPS })
      .notNull()
      .default('guardian'),
    isPrimaryBilling: flag('is_primary_billing', false),
    canSignWaivers: flag('can_sign_waivers', true),
    canViewProgress: flag('can_view_progress', true),
    canBookClasses: flag('can_book_classes', true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('family_links_pair_uq').on(t.guardianId, t.dependentId),
    index('family_links_dependent_idx').on(t.dependentId),
    index('family_links_academy_idx').on(t.academyId),
  ],
);
