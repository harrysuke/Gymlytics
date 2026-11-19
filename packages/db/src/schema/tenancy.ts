import { index, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { createdAt, deletedAt, id, json, updatedAt } from './_shared';

export interface AcademySettings {
  beltSystemId: string;
  checkInPinLength: number;
  gracePeriodDays: number;
  waiverVersion: number;
  autoCheckoutHours: number | null;
  promoMinMonths: Record<string, number>;
  currencyDecimals: number;
}

/**
 * Tenant root. Every other domain table carries academy_id so a single
 * deployment can serve multiple gyms with hard data isolation.
 */
export const academies = sqliteTable('academies', {
  id: id(),
  /** NULL = standalone or network root; set on branch locations. */
  parentAcademyId: text('parent_academy_id').references(
    (): AnySQLiteColumn => academies.id,
    { onDelete: 'set null' },
  ),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timezone: text('timezone').notNull().default('Asia/Kuala_Lumpur'),
  currency: text('currency', {
    enum: ['MYR', 'USD', 'SGD', 'THB', 'IDR', 'PHP', 'EUR', 'GBP', 'AUD'],
  })
    .notNull()
    .default('MYR'),
  countryCode: text('country_code').notNull().default('MY'),
  phone: text('phone'),
  email: text('email'),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  state: text('state'),
  postalCode: text('postal_code'),
  logoUrl: text('logo_url'),
  settings: json<AcademySettings>('settings')
    .notNull()
    .$defaultFn(() => ({
      beltSystemId: 'ibjjf_adult',
      checkInPinLength: 4,
      gracePeriodDays: 7,
      waiverVersion: 1,
      autoCheckoutHours: 3,
      promoMinMonths: {},
      currencyDecimals: 2,
    })),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [index('academies_parent_idx').on(t.parentAcademyId)]);
