import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { academies } from './tenancy';
import { users } from './users';
import { memberships, paymentMethods, PROVIDERS } from './billing';
import { cents, createdAt, deletedAt, flag, id, nullableIso, updatedAt } from './_shared';

export const RETAIL_CATEGORIES = [
  'gi',
  'rashguard',
  'tape',
  'drink',
  'supplement',
  'gear',
  'other',
] as const;

export const retailProducts = sqliteTable(
  'retail_products',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category', { enum: RETAIL_CATEGORIES }).notNull().default('other'),
    priceCents: cents('price_cents'),
    costCents: integer('cost_cents'),
    currency: text('currency').notNull().default('MYR'),
    stockQuantity: integer('stock_quantity').notNull().default(0),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(5),
    trackInventory: flag('track_inventory', true),
    size: text('size'),
    color: text('color'),
    imageUrl: text('image_url'),
    isActive: flag('is_active', true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex('retail_sku_uq').on(t.academyId, t.sku)],
);

export const TRANSACTION_TYPES = [
  'membership',
  'day_pass',
  'private_session',
  'seminar',
  'retail',
  'refund',
  'chargeback',
] as const;
export const TRANSACTION_STATUS = [
  'pending',
  'succeeded',
  'failed',
  'refunded',
  'partially_refunded',
] as const;

/** Unified ledger for memberships, day passes and POS retail. */
export const transactions = sqliteTable(
  'transactions',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    type: text('type', { enum: TRANSACTION_TYPES }).notNull(),
    status: text('status', { enum: TRANSACTION_STATUS }).notNull().default('pending'),

    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    payerId: text('payer_id').references(() => users.id, { onDelete: 'set null' }), // guardian paying for child
    membershipId: text('membership_id').references(() => memberships.id, {
      onDelete: 'set null',
    }),
    paymentMethodId: text('payment_method_id').references(() => paymentMethods.id, {
      onDelete: 'set null',
    }),

    subtotalCents: cents('subtotal_cents'),
    discountCents: cents('discount_cents'),
    taxCents: cents('tax_cents'),
    totalCents: cents('total_cents'),
    currency: text('currency').notNull().default('MYR'),

    provider: text('provider', { enum: PROVIDERS }).notNull().default('manual'),
    providerTransactionId: text('provider_transaction_id'),
    providerPaymentIntentId: text('provider_payment_intent_id'),
    idempotencyKey: text('idempotency_key').notNull().unique(),

    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    processedAt: nullableIso('processed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('transactions_user_idx').on(t.userId, t.createdAt),
    index('transactions_academy_date_idx').on(t.academyId, t.createdAt),
    index('transactions_provider_idx').on(t.provider, t.providerTransactionId),
  ],
);

export const transactionItems = sqliteTable(
  'transaction_items',
  {
    id: id(),
    transactionId: text('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    productId: text('product_id').references(() => retailProducts.id, {
      onDelete: 'set null',
    }),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPriceCents: cents('unit_price_cents'),
    totalCents: cents('total_cents'),
    createdAt: createdAt(),
  },
  (t) => [index('transaction_items_tx_idx').on(t.transactionId)],
);
