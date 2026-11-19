import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  attendanceLogs,
  bookings,
  classes,
  retailProducts,
  transactions,
  transactionItems,
  users,
  waivers,
  type Db,
} from '@gymlytics/db';
import type { SyncMutation } from '@gymlytics/shared';
import { recordChange } from '../../lib/change-log';
import { uuidv7 } from '../../lib/ids';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface ApplyInput {
  tx: Tx;
  academyId: string;
  deviceId: string;
  mutation: SyncMutation;
  serverHlc: string;
}

export interface ApplyResult {
  entityId: string;
  conflict: boolean;
  reason?: string;
}

/**
 * Server-side appliers. Each one is intentionally idempotent at the row level
 * as well as the mutation level: a kiosk can replay a batch after a lost
 * response, and two tablets can both try to create the same booking.
 */
export function applyMutation(input: ApplyInput): ApplyResult {
  const { mutation } = input;
  const payload = mutation.payload as Record<string, unknown>;

  switch (mutation.entity) {
    case 'attendance_log':
      return applyAttendance(input, payload);
    case 'booking':
      return applyBooking(input, payload);
    case 'waiver':
      return applyWaiver(input, payload);
    case 'dropin_user':
    case 'member':
      return applyMember(input, payload);
    case 'retail_transaction':
      return applyTransaction(input, payload);
    default:
      return { entityId: mutation.entityId, conflict: true, reason: 'Unknown entity' };
  }
}

function applyAttendance(input: ApplyInput, payload: Record<string, unknown>): ApplyResult {
  const { tx, mutation, academyId, deviceId, serverHlc } = input;
  const classId = String(payload['classId'] ?? '');
  const userId = String(payload['userId'] ?? '');
  const checkedInAt = String(payload['checkedInAt'] ?? new Date().toISOString());
  const method = String(payload['method'] ?? 'pin');

  const targetClass = tx
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.id, classId), eq(classes.academyId, academyId)))
    .get();
  if (!targetClass) {
    return { entityId: mutation.entityId, conflict: true, reason: 'Class not found on server' };
  }
  const member = tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.academyId, academyId)))
    .get();
  if (!member) {
    return { entityId: mutation.entityId, conflict: true, reason: 'Member not found on server' };
  }

  const existing = tx
    .select({ id: attendanceLogs.id })
    .from(attendanceLogs)
    .where(
      and(
        eq(attendanceLogs.classId, classId),
        eq(attendanceLogs.userId, userId),
        isNull(attendanceLogs.deletedAt),
      ),
    )
    .get();
  if (existing) {
    return { entityId: existing.id, conflict: false, reason: 'Already checked in' };
  }

  tx.insert(attendanceLogs)
    .values({
      id: mutation.entityId,
      academyId,
      classId,
      userId,
      checkedInAt,
      method: method as 'pin',
      status: 'checked_in',
      kioskId: deviceId,
      hlc: serverHlc,
      originDeviceId: deviceId,
      syncStatus: 'synced',
      mutationId: mutation.mutationId,
      syncedAt: new Date().toISOString(),
      version: mutation.version,
    })
    .run();

  tx.update(classes)
    .set({ checkedInCount: sql`${classes.checkedInCount} + 1` })
    .where(eq(classes.id, classId))
    .run();

  const booking = tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.classId, classId),
        eq(bookings.userId, userId),
        sql`${bookings.status} <> 'cancelled'`,
      ),
    )
    .get();
  if (booking) {
    tx.update(bookings).set({ status: 'checked_in' }).where(eq(bookings.id, booking.id)).run();
  } else {
    tx.insert(bookings)
      .values({
        id: uuidv7(),
        academyId,
        classId,
        userId,
        status: 'checked_in',
        source: 'kiosk',
        bookedAt: checkedInAt,
      })
      .run();
    tx.update(classes)
      .set({ bookedCount: sql`${classes.bookedCount} + 1` })
      .where(eq(classes.id, classId))
      .run();
  }

  recordChange(tx, {
    academyId,
    entity: 'attendance_log',
    entityId: mutation.entityId,
    operation: 'insert',
    payload: { ...payload, id: mutation.entityId, status: 'checked_in' },
    originDeviceId: deviceId,
  });
  return { entityId: mutation.entityId, conflict: false };
}

function applyBooking(input: ApplyInput, payload: Record<string, unknown>): ApplyResult {
  const { tx, mutation, academyId, deviceId } = input;
  const classId = String(payload['classId'] ?? '');
  const userId = String(payload['userId'] ?? '');
  const requestedStatus = String(payload['status'] ?? 'booked');

  const targetClass = tx
    .select()
    .from(classes)
    .where(and(eq(classes.id, classId), eq(classes.academyId, academyId)))
    .get();
  if (!targetClass) {
    return { entityId: mutation.entityId, conflict: true, reason: 'Class not found on server' };
  }

  const existing = tx
    .select({ id: bookings.id, status: bookings.status })
    .from(bookings)
    .where(
      and(
        eq(bookings.classId, classId),
        eq(bookings.userId, userId),
        sql`${bookings.status} <> 'cancelled'`,
      ),
    )
    .get();
  if (existing) {
    if (requestedStatus === 'cancelled') {
      tx.update(bookings)
        .set({ status: 'cancelled', cancelledAt: new Date().toISOString() })
        .where(eq(bookings.id, existing.id))
        .run();
      tx.update(classes)
        .set({ bookedCount: sql`max(0, ${classes.bookedCount} - 1)` })
        .where(eq(classes.id, classId))
        .run();
    }
    return { entityId: existing.id, conflict: false, reason: 'Booking already exists' };
  }

  const isFull = targetClass.bookedCount >= targetClass.capacity;
  const status = requestedStatus === 'cancelled' ? 'cancelled' : isFull ? 'waitlisted' : requestedStatus;

  tx.insert(bookings)
    .values({
      id: mutation.entityId,
      academyId,
      classId,
      userId,
      status: status as 'booked',
      source: String(payload['source'] ?? 'kiosk') as 'kiosk',
      bookedAt: String(payload['bookedAt'] ?? new Date().toISOString()),
    })
    .run();
  if (status === 'booked' || status === 'checked_in') {
    tx.update(classes)
      .set({ bookedCount: sql`${classes.bookedCount} + 1` })
      .where(eq(classes.id, classId))
      .run();
  }

  recordChange(tx, {
    academyId,
    entity: 'booking',
    entityId: mutation.entityId,
    operation: 'insert',
    payload: { ...payload, id: mutation.entityId, status },
    originDeviceId: deviceId,
  });
  return {
    entityId: mutation.entityId,
    conflict: false,
    ...(isFull ? { reason: 'Class was full — booking waitlisted' } : {}),
  };
}

function applyWaiver(input: ApplyInput, payload: Record<string, unknown>): ApplyResult {
  const { tx, mutation, academyId, deviceId } = input;
  const userId = String(payload['userId'] ?? '');
  const waiverType = String(payload['waiverType'] ?? 'general');
  const documentVersion = Number(payload['documentVersion'] ?? 1);

  const member = tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.academyId, academyId)))
    .get();
  if (!member) {
    return { entityId: mutation.entityId, conflict: true, reason: 'Member not found on server' };
  }

  const existing = tx
    .select({ id: waivers.id })
    .from(waivers)
    .where(
      and(
        eq(waivers.userId, userId),
        eq(waivers.waiverType, waiverType as 'general'),
        eq(waivers.documentVersion, documentVersion),
      ),
    )
    .get();
  if (existing) return { entityId: existing.id, conflict: false, reason: 'Waiver already signed' };

  const signedAt = String(payload['signedAt'] ?? new Date().toISOString());
  tx.insert(waivers)
    .values({
      id: mutation.entityId,
      academyId,
      userId,
      waiverType: waiverType as 'general',
      documentVersion,
      documentTitle: String(payload['documentTitle'] ?? 'Participation waiver'),
      documentHash: String(payload['documentHash'] ?? ''),
      signatureData: String(payload['signatureData'] ?? ''),
      signatureFormat: 'svg_path',
      signerName: String(payload['signerName'] ?? 'Member'),
      signerIp: String(payload['signerIp'] ?? 'offline-kiosk'),
      signedAt,
      expiresAt: payload['expiresAt'] ? String(payload['expiresAt']) : null,
      hlc: mutation.hlc,
      mutationId: mutation.mutationId,
      syncStatus: 'synced',
    })
    .run();

  recordChange(tx, {
    academyId,
    entity: 'waiver',
    entityId: mutation.entityId,
    operation: 'insert',
    payload: { ...payload, id: mutation.entityId, status: 'signed' },
    originDeviceId: deviceId,
  });
  return { entityId: mutation.entityId, conflict: false };
}

function applyMember(input: ApplyInput, payload: Record<string, unknown>): ApplyResult {
  const { tx, mutation, academyId, deviceId } = input;
  const id = mutation.entityId;
  const existing = tx.select({ id: users.id }).from(users).where(eq(users.id, id)).get();

  if (existing) {
    tx.update(users)
      .set({
        firstName: payload['firstName'] ? String(payload['firstName']) : undefined,
        lastName: payload['lastName'] ? String(payload['lastName']) : undefined,
        phone: payload['phone'] ? String(payload['phone']) : undefined,
        status: payload['status'] ? String(payload['status']) as 'active' : undefined,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, id))
      .run();
  } else {
    tx.insert(users)
      .values({
        id,
        academyId,
        role: String(payload['role'] ?? 'dropin') as 'dropin',
        status: String(payload['status'] ?? 'pending_waiver') as 'pending_waiver',
        firstName: String(payload['firstName'] ?? 'Visitor'),
        lastName: String(payload['lastName'] ?? ''),
        phone: payload['phone'] ? String(payload['phone']) : null,
        email: payload['email'] ? String(payload['email']) : null,
        qrToken: payload['qrToken'] ? String(payload['qrToken']) : `gym_${id.replace(/-/g, '')}`,
      })
      .run();
  }

  recordChange(tx, {
    academyId,
    entity: 'member',
    entityId: id,
    operation: existing ? 'update' : 'insert',
    payload: { ...payload, id },
    originDeviceId: deviceId,
  });
  return { entityId: id, conflict: false };
}

function applyTransaction(input: ApplyInput, payload: Record<string, unknown>): ApplyResult {
  const { tx, mutation, academyId, deviceId } = input;
  const existing = tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.id, mutation.entityId))
    .get();
  if (existing) return { entityId: existing.id, conflict: false, reason: 'Transaction already exists' };

  const totalCents = Number(payload['totalCents'] ?? 0);
  tx.insert(transactions)
    .values({
      id: mutation.entityId,
      academyId,
      type: String(payload['type'] ?? 'retail') as 'retail',
      status: String(payload['status'] ?? 'succeeded') as 'succeeded',
      userId: payload['userId'] ? String(payload['userId']) : null,
      payerId: payload['payerId'] ? String(payload['payerId']) : null,
      subtotalCents: Number(payload['subtotalCents'] ?? totalCents),
      discountCents: Number(payload['discountCents'] ?? 0),
      taxCents: Number(payload['taxCents'] ?? 0),
      totalCents,
      currency: String(payload['currency'] ?? 'MYR'),
      provider: String(payload['provider'] ?? 'manual') as 'manual',
      idempotencyKey: String(payload['idempotencyKey'] ?? `offline-${mutation.mutationId}`),
      processedAt: new Date().toISOString(),
    })
    .run();

  const items = Array.isArray(payload['items']) ? (payload['items'] as Record<string, unknown>[]) : [];
  for (const item of items) {
    tx.insert(transactionItems)
      .values({
        id: uuidv7(),
        transactionId: mutation.entityId,
        productId: item['productId'] ? String(item['productId']) : null,
        description: String(item['description'] ?? 'Item'),
        quantity: Number(item['quantity'] ?? 1),
        unitPriceCents: Number(item['unitPriceCents'] ?? 0),
        totalCents: Number(item['totalCents'] ?? 0),
      })
      .run();
    if (item['productId']) {
      tx.update(retailProducts)
        .set({ stockQuantity: sql`max(0, ${retailProducts.stockQuantity} - ${Number(item['quantity'] ?? 1)})` })
        .where(eq(retailProducts.id, String(item['productId'])))
        .run();
    }
  }

  recordChange(tx, {
    academyId,
    entity: 'retail_transaction',
    entityId: mutation.entityId,
    operation: 'insert',
    payload: { ...payload, id: mutation.entityId },
    originDeviceId: deviceId,
  });
  return { entityId: mutation.entityId, conflict: false };
}
