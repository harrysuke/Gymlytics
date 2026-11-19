import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { academies } from './tenancy';
import { users } from './users';
import { createdAt, deletedAt, flag, id, nullableIso, updatedAt, cents } from './_shared';

export const PLAN_TYPES = ['unlimited', 'weekly_limit', 'class_pack', 'dropin_pack', 'family'] as const;
export const BILLING_INTERVALS = ['monthly', 'quarterly', 'annual', 'one_time'] as const;
export const PROVIDERS = ['stripe', 'billplz', 'ipay88', 'manual'] as const;
export const MEMBERSHIP_STATUS = [
  'active',
  'trialing',
  'past_due',
  'frozen',
  'pending_payment',
  'cancelled',
  'expired',
] as const;

/** Cancellation reasons are captured at cancel time and reported in churn analytics. */
export const CANCELLATION_REASONS = [
  'too_expensive',
  'relocated',
  'time_constraints',
  'injury',
  'switched_gym',
  'dissatisfied',
  'other',
] as const;

export const membershipPlans = sqliteTable(
  'membership_plans',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    planType: text('plan_type', { enum: PLAN_TYPES }).notNull(),
    billingInterval: text('billing_interval', { enum: BILLING_INTERVALS })
      .notNull()
      .default('monthly'),
    priceCents: cents('price_cents'),
    currency: text('currency').notNull().default('MYR'),
    classesPerWeek: integer('classes_per_week'),
    classPackCount: integer('class_pack_count'),
    familyDiscountPercent: integer('family_discount_percent').notNull().default(0),
    maxDependents: integer('max_dependents').notNull().default(0),
    freezeAllowed: flag('freeze_allowed', true),
    freezeMaxDaysPerYear: integer('freeze_max_days_per_year').notNull().default(30),
    isActive: flag('is_active', true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('membership_plans_academy_idx').on(t.academyId, t.isActive)],
);

/** A user's current entitlement. One active row per (user, plan). */
export const memberships = sqliteTable(
  'memberships',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .references(() => membershipPlans.id, { onDelete: 'restrict' }),
    status: text('status', { enum: MEMBERSHIP_STATUS }).notNull().default('pending_payment'),

    currentPeriodStart: text('current_period_start').notNull(),
    currentPeriodEnd: text('current_period_end').notNull(),
    classesUsedInPeriod: integer('classes_used_in_period').notNull().default(0),

    frozenAt: nullableIso('frozen_at'),
    freezeUntil: nullableIso('freeze_until'),
    totalFrozenDays: integer('total_frozen_days').notNull().default(0),

    provider: text('provider', { enum: PROVIDERS }).notNull().default('manual'),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    defaultPaymentMethodId: text('default_payment_method_id'),

    nextBillingAt: nullableIso('next_billing_at'),
    cancelledAt: nullableIso('cancelled_at'),
    cancelAtPeriodEnd: flag('cancel_at_period_end', false),
    cancellationReason: text('cancellation_reason', { enum: CANCELLATION_REASONS }),
    cancellationNote: text('cancellation_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('memberships_user_idx').on(t.userId, t.status),
    index('memberships_renewal_idx').on(t.status, t.nextBillingAt),
  ],
);

/** Provider token references only — PAN/CVV never touch our database. */
export const paymentMethods = sqliteTable(
  'payment_methods',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: PROVIDERS }).notNull(),
    providerCustomerId: text('provider_customer_id').notNull(),
    providerPaymentMethodId: text('provider_payment_method_id').notNull(),
    brand: text('brand'),
    last4: text('last_4'),
    expiryMonth: integer('expiry_month'),
    expiryYear: integer('expiry_year'),
    isDefault: flag('is_default', false),
    status: text('status', { enum: ['active', 'expired', 'removed'] })
      .notNull()
      .default('active'),
    createdAt: createdAt(),
  },
  (t) => [index('payment_methods_user_idx').on(t.userId, t.status)],
);

/** Dunning ledger. transactionId intentionally untyped to avoid a schema cycle. */
export const paymentRetries = sqliteTable(
  'payment_retries',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    membershipId: text('membership_id').references(() => memberships.id, {
      onDelete: 'cascade',
    }),
    transactionId: text('transaction_id'),
    attemptNumber: integer('attempt_number').notNull(),
    scheduledAt: text('scheduled_at').notNull(),
    attemptedAt: nullableIso('attempted_at'),
    status: text('status', {
      enum: ['scheduled', 'attempted', 'succeeded', 'abandoned'],
    })
      .notNull()
      .default('scheduled'),
    provider: text('provider', { enum: PROVIDERS }),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    createdAt: createdAt(),
  },
  (t) => [index('payment_retries_due_idx').on(t.status, t.scheduledAt)],
);
