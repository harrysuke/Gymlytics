import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  appliedMutations,
  attendanceLogs,
  bookings,
  classes,
  programs,
  users,
  type Db,
} from '@gymlytics/db';
import {
  attendanceQuerySchema,
  checkInSchema,
  checkOutSchema,
  type CheckInResult,
} from '@gymlytics/shared';
import { auth, requireRole } from '../../lib/auth';
import { recordChange } from '../../lib/change-log';
import { hashPin, parseJsonBody } from '../../lib/crypto';
import { getActiveMembership, waiverState } from '../../lib/entitlements';
import { HttpError, forbidden, notFound, unprocessable } from '../../lib/errors';
import { serverClock } from '../../lib/hlc';
import { uuidv7 } from '../../lib/ids';

export async function registerAttendanceRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.post('/v1/check-in', async (request, reply) => {
    const context = auth(request);
    const body = await parseJsonBody(request, checkInSchema);
    if (body.academyId !== context.academyId) throw forbidden('Cross-academy check-in denied');

    const replay = db
      .select()
      .from(appliedMutations)
      .where(eq(appliedMutations.mutationId, body.mutationId))
      .get();
    if (replay) return { ok: true, data: replay.resultJson as unknown as CheckInResult };

    const targetClass = db
      .select()
      .from(classes)
      .where(and(eq(classes.id, body.classId), eq(classes.academyId, context.academyId)))
      .get();
    if (!targetClass) throw notFound('Class not found');
    if (targetClass.status === 'cancelled') throw unprocessable('This class was cancelled');

    const member = resolveMember(db, context.academyId, body);
    if (member.status === 'inactive') throw forbidden('Member is inactive');

    const existing = db
      .select({ id: attendanceLogs.id, checkedInAt: attendanceLogs.checkedInAt })
      .from(attendanceLogs)
      .where(
        and(
          eq(attendanceLogs.classId, body.classId),
          eq(attendanceLogs.userId, member.id),
          isNull(attendanceLogs.deletedAt),
        ),
      )
      .get();
    if (existing) {
      return {
        ok: true,
        data: {
          attendanceId: existing.id,
          userId: member.id,
          status: 'checked_in',
          checkedInAt: existing.checkedInAt,
          synced: true,
          warnings: ['Already checked in for this class'],
        } satisfies CheckInResult,
      };
    }

    const waiver = waiverState(db, member.id);
    if (!waiver.valid && body.method !== 'admin') {
      throw new HttpError(
        422,
        'waiver_required',
        'A signed waiver is required before stepping on the mat',
        { userId: member.id },
      );
    }

    const membership = getActiveMembership(db, member.id);
    const membershipOk =
      membership &&
      ['active', 'trialing'].includes(membership.status) &&
      new Date(membership.currentPeriodEnd) > new Date();
    if (!membershipOk && body.method !== 'admin') {
      throw new HttpError(
        422,
        'membership_required',
        'No active membership or day pass found',
        { userId: member.id },
      );
    }

    const attendanceId = uuidv7();
    const now = new Date().toISOString();
    const hlc = serverClock.tick();
    const warnings: string[] = [];
    if (membership?.status === 'past_due') warnings.push('Membership is past due');
    if (waiver.expiresAt && new Date(waiver.expiresAt).getTime() - Date.now() < 14 * 86_400_000) {
      warnings.push('Waiver expires soon');
    }

    const result: CheckInResult = {
      attendanceId,
      userId: member.id,
      status: 'checked_in',
      checkedInAt: now,
      synced: true,
      warnings,
    };

    db.transaction((tx) => {
      tx.insert(attendanceLogs)
        .values({
          id: attendanceId,
          academyId: context.academyId,
          classId: body.classId,
          userId: member.id,
          checkedInAt: now,
          method: body.method,
          status: 'checked_in',
          kioskId: body.deviceId,
          hlc,
          originDeviceId: body.deviceId,
          syncStatus: 'synced',
          mutationId: body.mutationId,
          syncedAt: now,
          version: 1,
        })
        .run();

      tx.update(classes)
        .set({ checkedInCount: sql`${classes.checkedInCount} + 1` })
        .where(eq(classes.id, body.classId))
        .run();

      const booking = tx
        .select({ id: bookings.id, status: bookings.status })
        .from(bookings)
        .where(
          and(
            eq(bookings.classId, body.classId),
            eq(bookings.userId, member.id),
            sql`${bookings.status} <> 'cancelled'`,
          ),
        )
        .get();
      if (booking) {
        tx.update(bookings)
          .set({ status: 'checked_in', updatedAt: now })
          .where(eq(bookings.id, booking.id))
          .run();
        recordChange(tx, {
          academyId: context.academyId,
          entity: 'booking',
          entityId: booking.id,
          operation: 'update',
          payload: { id: booking.id, status: 'checked_in' },
          originDeviceId: body.deviceId,
        });
      } else {
        const bookingId = uuidv7();
        tx.insert(bookings)
          .values({
            id: bookingId,
            academyId: context.academyId,
            classId: body.classId,
            userId: member.id,
            status: 'checked_in',
            source: 'kiosk',
            bookedAt: now,
          })
          .run();
        tx.update(classes)
          .set({ bookedCount: sql`${classes.bookedCount} + 1` })
          .where(eq(classes.id, body.classId))
          .run();
        recordChange(tx, {
          academyId: context.academyId,
          entity: 'booking',
          entityId: bookingId,
          operation: 'insert',
          payload: {
            id: bookingId,
            classId: body.classId,
            userId: member.id,
            status: 'checked_in',
            source: 'kiosk',
          },
          originDeviceId: body.deviceId,
        });
      }

      recordChange(tx, {
        academyId: context.academyId,
        entity: 'attendance_log',
        entityId: attendanceId,
        operation: 'insert',
        payload: {
          id: attendanceId,
          academyId: context.academyId,
          classId: body.classId,
          userId: member.id,
          checkedInAt: now,
          method: body.method,
          status: 'checked_in',
          kioskId: body.deviceId,
          version: 1,
        },
        originDeviceId: body.deviceId,
      });

      tx.insert(appliedMutations)
        .values({
          mutationId: body.mutationId,
          academyId: context.academyId,
          deviceId: body.deviceId,
          entity: 'attendance_log',
          entityId: attendanceId,
          resultJson: result as unknown as Record<string, unknown>,
        })
        .onConflictDoNothing()
        .run();
    });

    return reply.code(201).send({ ok: true, data: result });
  });

  app.post('/v1/check-out', async (request) => {
    const context = auth(request);
    const body = await parseJsonBody(request, checkOutSchema);
    const attendance = db
      .select()
      .from(attendanceLogs)
      .where(and(eq(attendanceLogs.id, body.attendanceId), eq(attendanceLogs.academyId, context.academyId)))
      .get();
    if (!attendance) throw notFound('Attendance record not found');
    if (attendance.checkedOutAt) return { ok: true, data: { alreadyCheckedOut: true } };

    db.transaction((tx) => {
      tx.update(attendanceLogs)
        .set({
          checkedOutAt: body.checkedOutAt,
          status: 'checked_out',
          updatedAt: new Date().toISOString(),
          version: sql`${attendanceLogs.version} + 1`,
        })
        .where(eq(attendanceLogs.id, body.attendanceId))
        .run();
      recordChange(tx, {
        academyId: context.academyId,
        entity: 'attendance_log',
        entityId: body.attendanceId,
        operation: 'update',
        payload: { id: body.attendanceId, checkedOutAt: body.checkedOutAt, status: 'checked_out' },
      });
    });

    return { ok: true, data: { checkedOutAt: body.checkedOutAt } };
  });

  app.get('/v1/attendance', { preHandler: requireRole('owner', 'admin', 'coach', 'staff') }, async (request) => {
    const context = auth(request);
    const query = attendanceQuerySchema.parse(request.query);
    const conditions = [
      eq(attendanceLogs.academyId, context.academyId),
      isNull(attendanceLogs.deletedAt),
    ];
    if (query.from) conditions.push(gte(attendanceLogs.checkedInAt, query.from));
    if (query.to) conditions.push(lte(attendanceLogs.checkedInAt, query.to));
    if (query.programId) conditions.push(eq(classes.programId, query.programId));

    const rows = db
      .select({
        id: attendanceLogs.id,
        checkedInAt: attendanceLogs.checkedInAt,
        checkedOutAt: attendanceLogs.checkedOutAt,
        method: attendanceLogs.method,
        status: attendanceLogs.status,
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        classId: classes.id,
        classTitle: classes.title,
        startsAt: classes.startsAt,
        programName: programs.name,
      })
      .from(attendanceLogs)
      .innerJoin(users, eq(users.id, attendanceLogs.userId))
      .innerJoin(classes, eq(classes.id, attendanceLogs.classId))
      .innerJoin(programs, eq(programs.id, classes.programId))
      .where(and(...conditions))
      .orderBy(desc(attendanceLogs.checkedInAt))
      .limit(query.limit)
      .all();

    return { ok: true, data: rows };
  });
}

function resolveMember(
  db: Db,
  academyId: string,
  body: ReturnType<typeof checkInSchema.parse>,
): typeof users.$inferSelect {
  if (body.method === 'pin') {
    const row = db
      .select()
      .from(users)
      .where(
        and(
          eq(users.academyId, academyId),
          eq(users.pinHash, hashPin(academyId, body.pin)),
          isNull(users.deletedAt),
        ),
      )
      .get();
    if (!row) throw notFound('PIN not recognised');
    return row;
  }
  if (body.method === 'qr') {
    const row = db
      .select()
      .from(users)
      .where(and(eq(users.academyId, academyId), eq(users.qrToken, body.qrToken), isNull(users.deletedAt)))
      .get();
    if (!row) throw notFound('QR code not recognised');
    return row;
  }
  const row = db
    .select()
    .from(users)
    .where(and(eq(users.academyId, academyId), eq(users.id, body.userId), isNull(users.deletedAt)))
    .get();
  if (!row) throw notFound('Member not found');
  return row;
}
