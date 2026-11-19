import { z } from 'zod';
import { hlcSchema, uuidSchema } from './common';

const baseCheckIn = {
  academyId: uuidSchema,
  classId: uuidSchema,
  // Client-generated so the kiosk can write offline. Server dedupes on this.
  mutationId: uuidSchema,
  hlc: hlcSchema,
  deviceId: z.string().min(3).max(80),
  checkedInAt: z.string().datetime({ offset: true }),
};

export const checkInSchema = z.discriminatedUnion('method', [
  z.object({
    ...baseCheckIn,
    method: z.literal('pin'),
    pin: z.string().regex(/^\d{4,8}$/),
  }),
  z.object({
    ...baseCheckIn,
    method: z.literal('qr'),
    qrToken: z.string().min(12).max(256),
  }),
  z.object({
    ...baseCheckIn,
    method: z.literal('name_search'),
    userId: uuidSchema,
    staffConfirmation: z.literal(true),
  }),
  z.object({ ...baseCheckIn, method: z.literal('mobile'), userId: uuidSchema }),
  /**
   * Staff override from the admin dashboard. Bypasses the waiver and active
   * membership gates, so it must carry a reason for the audit trail.
   */
  z.object({
    ...baseCheckIn,
    method: z.literal('admin'),
    userId: uuidSchema,
    overrideReason: z.string().min(3).max(280),
  }),
]);
export type CheckInInput = z.infer<typeof checkInSchema>;

export const checkOutSchema = z.object({
  academyId: uuidSchema,
  attendanceId: uuidSchema,
  mutationId: uuidSchema,
  hlc: hlcSchema,
  checkedOutAt: z.string().datetime({ offset: true }),
});

export const checkInResultSchema = z.object({
  attendanceId: uuidSchema,
  userId: uuidSchema,
  status: z.enum(['checked_in', 'checked_out', 'no_show', 'cancelled']),
  checkedInAt: z.string(),
  synced: z.boolean(),
  conflict: z.boolean().optional(),
  warnings: z.array(z.string()).default([]), // e.g. "waiver expired", "membership past due"
});
export type CheckInResult = z.infer<typeof checkInResultSchema>;

/** ---- Generic delta-sync envelope (shared by kiosk and API) ---- */

export const syncMutationSchema = z.object({
  mutationId: uuidSchema,
  academyId: uuidSchema,
  deviceId: z.string().min(3).max(80),
  entity: z.enum([
    'attendance_log',
    'booking',
    'waiver',
    'dropin_user',
    'member',
    'retail_transaction',
  ]),
  entityId: uuidSchema,
  operation: z.enum(['insert', 'update', 'delete']),
  payload: z.record(z.unknown()),
  hlc: hlcSchema,
  version: z.number().int().positive(),
});
export type SyncMutation = z.infer<typeof syncMutationSchema>;

export const syncPushSchema = z.object({
  mutations: z.array(syncMutationSchema).max(200),
});
export type SyncPushBody = z.infer<typeof syncPushSchema>;

export const syncPullQuerySchema = z.object({
  deviceId: z.string().min(3).max(80),
  since: hlcSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const syncAckSchema = z.object({
  mutationId: uuidSchema,
  accepted: z.boolean(),
  entityId: uuidSchema,
  serverVersion: z.number().int().positive(),
  conflict: z.boolean().default(false),
  serverHlc: hlcSchema,
  reason: z.string().optional(),
});
export type SyncAck = z.infer<typeof syncAckSchema>;

export const syncPushResultSchema = z.object({
  acks: z.array(syncAckSchema),
  serverHlc: hlcSchema,
});
export type SyncPushResult = z.infer<typeof syncPushResultSchema>;

export const syncPullResultSchema = z.object({
  changes: z.array(
    z.object({
      entity: z.string(),
      entityId: uuidSchema,
      operation: z.enum(['insert', 'update', 'delete']),
      payload: z.record(z.unknown()),
      hlc: hlcSchema,
      version: z.number().int().positive(),
    }),
  ),
  serverHlc: hlcSchema,
  hasMore: z.boolean(),
});
export type SyncPullResult = z.infer<typeof syncPullResultSchema>;
