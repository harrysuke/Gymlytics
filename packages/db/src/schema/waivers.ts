import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { academies } from './tenancy';
import { users } from './users';
import { programs } from './programs';
import { createdAt, id, nullableIso, updatedAt } from './_shared';

export const WAIVER_TYPES = ['general', 'participation', 'photo_release', 'medical', 'dropin'] as const;

/**
 * Versioned legal text. The signed waiver stores only the hash, so the exact
 * wording a member agreed to can always be reconstructed and rendered to PDF.
 */
export const waiverTemplates = sqliteTable(
  'waiver_templates',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    waiverType: text('waiver_type', { enum: WAIVER_TYPES }).notNull(),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    bodyMarkdown: text('body_markdown').notNull(),
    documentHash: text('document_hash').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('waiver_templates_version_uq').on(t.academyId, t.waiverType, t.version),
    index('waiver_templates_active_idx').on(t.academyId, t.waiverType, t.isActive),
  ],
);

/**
 * Signed waiver artifact. The exact document text is versioned by
 * `documentVersion` + `documentHash`; signature is captured as an SVG path
 * (small, scalable, vector) and rendered to PDF server-side on demand.
 */
export const waivers = sqliteTable(
  'waivers',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    programId: text('program_id').references(() => programs.id, { onDelete: 'set null' }),
    waiverType: text('waiver_type', { enum: WAIVER_TYPES }).notNull(),
    documentVersion: integer('document_version').notNull(),

    documentTitle: text('document_title').notNull(),
    documentHash: text('document_hash').notNull(), // SHA-256 of immutable legal text
    signatureData: text('signature_data').notNull(), // SVG path d="" or PNG data URI
    signatureFormat: text('signature_format', {
      enum: ['svg_path', 'png_data_uri', 'raw_points'],
    })
      .notNull()
      .default('svg_path'),

    signerName: text('signer_name').notNull(),
    signerIp: text('signer_ip').notNull(),
    userAgent: text('user_agent'),
    signedAt: text('signed_at').notNull(),
    dateOfBirthSnapshot: text('date_of_birth_snapshot'),
    guardianUserId: text('guardian_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    status: text('status', { enum: ['signed', 'voided', 'expired'] })
      .notNull()
      .default('signed'),
    expiresAt: nullableIso('expires_at'),
    pdfUrl: text('pdf_url'),

    // Kiosk can capture a waiver offline too — same sync primitives.
    hlc: text('hlc').notNull(),
    mutationId: text('mutation_id').notNull(),
    syncStatus: text('sync_status', {
      enum: ['local', 'pending', 'synced', 'conflict'],
    })
      .notNull()
      .default('local'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('waivers_version_uq').on(t.userId, t.waiverType, t.documentVersion),
    uniqueIndex('waivers_mutation_uq').on(t.mutationId),
    index('waivers_user_idx').on(t.userId, t.status),
  ],
);
