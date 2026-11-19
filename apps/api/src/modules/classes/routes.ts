import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  attendanceLogs,
  bookings,
  classes,
  classTechniques,
  curriculumTechniques,
  familyLinks,
  programs,
  users,
  type Db,
} from '@gymlytics/db';
import {
  classListQuerySchema,
  createBookingSchema,
  createClassSchema,
} from '@gymlytics/shared';
import { auth, requireRole } from '../../lib/auth';
import { recordChange } from '../../lib/change-log';
import { parseJsonBody } from '../../lib/crypto';
import { assertCanBook } from '../../lib/entitlements';
import { badRequest, forbidden, notFound, unprocessable } from '../../lib/errors';
import { uuidv7 } from '../../lib/ids';

const ACTIVE_BOOKING_STATES = ['booked', 'checked_in', 'attended'] as const;

export async function registerClassRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get('/v1/classes', async (request) => {
    const context = auth(request);
    const query = classListQuerySchema.parse(request.query);
    const from = query.from ?? new Date().toISOString();
    const to = query.to ?? new Date(Date.now() + 14 * 86_400_000).toISOString();

    const conditions = [
      eq(classes.academyId, context.academyId),
      isNull(classes.deletedAt),
      gte(classes.startsAt, from),
      lte(classes.startsAt, to),
    ];
    if (query.programId) conditions.push(eq(classes.programId, query.programId));
    if (query.availableOnly) conditions.push(sql`${classes.bookedCount} < ${classes.capacity}`);

    const rows = db
      .select({
        id: classes.id,
        programId: classes.programId,
        programName: programs.name,
        discipline: programs.discipline,
        coachId: classes.coachId,
        coachFirstName: users.firstName,
        coachLastName: users.lastName,
        title: classes.title,
        startsAt: classes.startsAt,
        endsAt: classes.endsAt,
        capacity: classes.capacity,
        bookedCount: classes.bookedCount,
        checkedInCount: classes.checkedInCount,
        location: classes.location,
        status: classes.status,
      })
      .from(classes)
      .innerJoin(programs, eq(programs.id, classes.programId))
      .leftJoin(users, eq(users.id, classes.coachId))
      .where(and(...conditions))
      .orderBy(asc(classes.startsAt))
      .limit(query.limit)
      .all();

    return {
      ok: true,
      data: rows.map((row) => ({
        ...row,
        coachName:
          row.coachFirstName && row.coachLastName ? `${row.coachFirstName} ${row.coachLastName}` : null,
        spotsLeft: Math.max(0, row.capacity - row.bookedCount),
      })),
    };
  });

  app.post('/v1/classes', { preHandler: requireRole('owner', 'admin', 'coach') }, async (request, reply) => {
    const context = auth(request);
    const body = await parseJsonBody(request, createClassSchema);
    if (new Date(body.endsAt) <= new Date(body.startsAt)) {
      throw badRequest('Class must end after it starts');
    }
    const program = db
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.id, body.programId), eq(programs.academyId, context.academyId)))
      .get();
    if (!program) throw notFound('Program not found');

    const id = uuidv7();
    db.insert(classes)
      .values({
        id,
        academyId: context.academyId,
        programId: body.programId,
        templateId: body.templateId ?? null,
        coachId: body.coachId ?? null,
        title: body.title,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        capacity: body.capacity,
        location: body.location ?? null,
        notes: body.notes ?? null,
      })
      .run();
    return reply.code(201).send({ ok: true, data: { id } });
  });

  app.get('/v1/classes/:id', async (request) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    const row = db
      .select({
        class: classes,
        programName: programs.name,
        programDiscipline: programs.discipline,
      })
      .from(classes)
      .innerJoin(programs, eq(programs.id, classes.programId))
      .where(and(eq(classes.id, id), eq(classes.academyId, context.academyId)))
      .get();
    if (!row) throw notFound('Class not found');

    const roster = db
      .select({
        bookingId: bookings.id,
        bookingStatus: bookings.status,
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        attendanceId: attendanceLogs.id,
        attendanceStatus: attendanceLogs.status,
        checkedInAt: attendanceLogs.checkedInAt,
      })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.userId))
      .leftJoin(
        attendanceLogs,
        and(
          eq(attendanceLogs.classId, bookings.classId),
          eq(attendanceLogs.userId, bookings.userId),
          isNull(attendanceLogs.deletedAt),
        ),
      )
      .where(and(eq(bookings.classId, id), sql`${bookings.status} <> 'cancelled'`))
      .orderBy(asc(users.lastName))
      .all();

    const techniques = db
      .select({
        id: classTechniques.id,
        techniqueId: classTechniques.techniqueId,
        name: curriculumTechniques.name,
        category: curriculumTechniques.category,
      })
      .from(classTechniques)
      .innerJoin(curriculumTechniques, eq(curriculumTechniques.id, classTechniques.techniqueId))
      .where(eq(classTechniques.classId, id))
      .all();

    return {
      ok: true,
      data: {
        ...row.class,
        programName: row.programName,
        programDiscipline: row.programDiscipline,
        roster,
        techniques,
        spotsLeft: Math.max(0, row.class.capacity - row.class.bookedCount),
      },
    };
  });

  app.post('/v1/classes/:id/bookings', async (request, reply) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    const body = await parseJsonBody(request, createBookingSchema);
    const beneficiaryId = body.bookedFor ?? body.userId;

    if (context.role === 'student' || context.role === 'guardian' || context.role === 'dropin') {
      if (beneficiaryId !== context.userId) {
        const link = db
          .select({ id: familyLinks.id, canBookClasses: familyLinks.canBookClasses })
          .from(familyLinks)
          .where(
            and(
              eq(familyLinks.guardianId, context.userId),
              eq(familyLinks.dependentId, beneficiaryId),
            ),
          )
          .get();
        if (!link || !link.canBookClasses) throw forbidden('You cannot book for this member');
      }
    }

    const targetClass = db
      .select()
      .from(classes)
      .where(and(eq(classes.id, id), eq(classes.academyId, context.academyId)))
      .get();
    if (!targetClass) throw notFound('Class not found');
    if (targetClass.status === 'cancelled') throw unprocessable('This class was cancelled');
    if (new Date(targetClass.startsAt) < new Date()) throw unprocessable('This class has already started');

    assertCanBook(db, beneficiaryId);

    const existing = db
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(
        and(
          eq(bookings.classId, id),
          eq(bookings.userId, beneficiaryId),
          sql`${bookings.status} <> 'cancelled'`,
        ),
      )
      .get();
    if (existing) throw unprocessable('Member already has a booking for this class');

    const activeCount = db
      .select({ count: sql<number>`count(*)` })
      .from(bookings)
      .where(and(eq(bookings.classId, id), inArray(bookings.status, [...ACTIVE_BOOKING_STATES])))
      .get();
    const isFull = (activeCount?.count ?? 0) >= targetClass.capacity;
    const bookingStatus = isFull ? 'waitlisted' : 'booked';
    const bookingId = uuidv7();
    const now = new Date().toISOString();

    db.transaction((tx) => {
      tx.insert(bookings)
        .values({
          id: bookingId,
          academyId: context.academyId,
          classId: id,
          userId: beneficiaryId,
          status: bookingStatus,
          source: body.source,
          bookedAt: now,
        })
        .run();
      if (!isFull) {
        tx.update(classes)
          .set({ bookedCount: sql`${classes.bookedCount} + 1` })
          .where(eq(classes.id, id))
          .run();
      }
      recordChange(tx, {
        academyId: context.academyId,
        entity: 'booking',
        entityId: bookingId,
        operation: 'insert',
        payload: {
          id: bookingId,
          academyId: context.academyId,
          classId: id,
          userId: beneficiaryId,
          status: bookingStatus,
          source: body.source,
          bookedAt: now,
          version: 1,
        },
      });
    });

    return reply.code(201).send({
      ok: true,
      data: { id: bookingId, status: bookingStatus, waitlisted: isFull },
    });
  });

  app.delete('/v1/bookings/:id', async (request) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    const booking = db.select().from(bookings).where(eq(bookings.id, id)).get();
    if (!booking || booking.academyId !== context.academyId) throw notFound('Booking not found');

    const canManage = ['owner', 'admin', 'staff', 'coach'].includes(context.role);
    if (!canManage && booking.userId !== context.userId) throw forbidden();

    if (booking.status === 'cancelled') return { ok: true, data: { cancelled: true } };
    const now = new Date().toISOString();

    db.transaction((tx) => {
      tx.update(bookings)
        .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
        .where(eq(bookings.id, id))
        .run();
      if (booking.status === 'booked' || booking.status === 'checked_in') {
        tx.update(classes)
          .set({ bookedCount: sql`max(0, ${classes.bookedCount} - 1)` })
          .where(eq(classes.id, booking.classId))
          .run();
      }
      recordChange(tx, {
        academyId: context.academyId,
        entity: 'booking',
        entityId: id,
        operation: 'update',
        payload: { id, status: 'cancelled', cancelledAt: now },
      });
    });

    return { ok: true, data: { cancelled: true } };
  });

  app.post('/v1/classes/:id/techniques', { preHandler: requireRole('owner', 'admin', 'coach') }, async (request, reply) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    const body = await parseJsonBody(
      request,
      z.object({
        techniqueIds: z.array(z.string().uuid()).min(1).max(20),
        notes: z.string().max(2_000).optional(),
      }),
    );

    const targetClass = db
      .select({ id: classes.id })
      .from(classes)
      .where(and(eq(classes.id, id), eq(classes.academyId, context.academyId)))
      .get();
    if (!targetClass) throw notFound('Class not found');

    for (const techniqueId of body.techniqueIds) {
      db.insert(classTechniques)
        .values({
          id: uuidv7(),
          academyId: context.academyId,
          classId: id,
          techniqueId,
          taughtBy: context.userId,
          notes: body.notes ?? null,
        })
        .onConflictDoNothing()
        .run();
    }
    return reply.code(201).send({ ok: true, data: { logged: body.techniqueIds.length } });
  });

  app.get('/v1/me/bookings', async (request) => {
    const context = auth(request);
    const query = z.object({ includePast: z.coerce.boolean().default(false) }).parse(request.query);
    const conditions = [eq(bookings.userId, context.userId), sql`${bookings.status} <> 'cancelled'`];
    if (!query.includePast) conditions.push(gte(classes.startsAt, new Date().toISOString()));

    const rows = db
      .select({
        id: bookings.id,
        status: bookings.status,
        bookedAt: bookings.bookedAt,
        classId: classes.id,
        title: classes.title,
        startsAt: classes.startsAt,
        endsAt: classes.endsAt,
        location: classes.location,
        programName: programs.name,
        capacity: classes.capacity,
        bookedCount: classes.bookedCount,
      })
      .from(bookings)
      .innerJoin(classes, eq(classes.id, bookings.classId))
      .innerJoin(programs, eq(programs.id, classes.programId))
      .where(and(...conditions))
      .orderBy(asc(classes.startsAt))
      .all();
    return { ok: true, data: rows };
  });

  app.get('/v1/me/attendance', async (request) => {
    const context = auth(request);
    const rows = db
      .select({
        id: attendanceLogs.id,
        checkedInAt: attendanceLogs.checkedInAt,
        checkedOutAt: attendanceLogs.checkedOutAt,
        status: attendanceLogs.status,
        method: attendanceLogs.method,
        classTitle: classes.title,
        startsAt: classes.startsAt,
        programName: programs.name,
      })
      .from(attendanceLogs)
      .innerJoin(classes, eq(classes.id, attendanceLogs.classId))
      .innerJoin(programs, eq(programs.id, classes.programId))
      .where(and(eq(attendanceLogs.userId, context.userId), isNull(attendanceLogs.deletedAt)))
      .orderBy(desc(attendanceLogs.checkedInAt))
      .limit(50)
      .all();
    return { ok: true, data: rows };
  });
}
