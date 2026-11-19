import { and, asc, eq, gte, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  affiliations,
  appliedMutations,
  attendanceLogs,
  classes,
  crossTrainingPasses,
  users,
  waivers,
  type Db,
} from '@gymlytics/db';
import {
  affiliationSchema,
  crossTrainingPassSchema,
  linkWaiverSchema,
  passCheckInSchema,
} from '@gymlytics/shared';
import { auth, requireRole } from '../../lib/auth';
import { recordChange } from '../../lib/change-log';
import { parseJsonBody, randomToken } from '../../lib/crypto';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors';
import { serverClock } from '../../lib/hlc';
import { uuidv7 } from '../../lib/ids';
import { requireFeature } from '../../lib/saas';

export async function registerPassRoutes(app: FastifyInstance, db: Db): Promise<void> {
  const staff = requireRole('owner', 'admin', 'coach', 'staff');

  // ------------------------------------------------------------- affiliations
  app.get('/v1/affiliations', { preHandler: staff }, async (request) => {
    const { academyId } = auth(request);
    return {
      ok: true,
      data: db.select().from(affiliations)
        .where(eq(affiliations.academyId, academyId))
        .orderBy(asc(affiliations.name)).all(),
    };
  });

  app.post('/v1/affiliations', { preHandler: [staff, requireFeature(db, 'cross_training')] }, async (request, reply) => {
    const { academyId } = auth(request);
    const body = await parseJsonBody(request, affiliationSchema);
    const id = uuidv7();
    db.insert(affiliations).values({
      id,
      academyId,
      name: body.name,
      contactEmail: body.contactEmail,
      notes: body.notes,
      verificationCode: `AFF-${randomToken(6).toUpperCase()}`,
    }).run();
    return reply.code(201).send({ ok: true, data: { id } });
  });

  app.post('/v1/affiliations/:id/verify', { preHandler: staff }, async (request) => {
    const { academyId } = auth(request);
    const { id } = request.params as { id: string };
    const row = db.select().from(affiliations)
      .where(and(eq(affiliations.id, id), eq(affiliations.academyId, academyId))).get();
    if (!row) throw notFound('Affiliation not found');
    db.update(affiliations).set({ verifiedAt: new Date().toISOString() }).where(eq(affiliations.id, id)).run();
    return { ok: true, data: { id, verifiedAt: new Date().toISOString() } };
  });

  // -------------------------------------------------------------- day passes
  app.get('/v1/passes', { preHandler: staff }, async (request) => {
    const { academyId } = auth(request);
    const query = (request.query ?? {}) as { date?: string };
    const rows = db.select({
      pass: crossTrainingPasses,
      visitorName: users.firstName,
      visitorLastName: users.lastName,
      affiliationName: affiliations.name,
    })
      .from(crossTrainingPasses)
      .innerJoin(users, eq(crossTrainingPasses.userId, users.id))
      .leftJoin(affiliations, eq(crossTrainingPasses.affiliationId, affiliations.id))
      .where(and(
        eq(crossTrainingPasses.academyId, academyId),
        ...(query.date ? [eq(crossTrainingPasses.passDate, query.date)] : []),
      ))
      .orderBy(asc(crossTrainingPasses.createdAt))
      .limit(100)
      .all();
    return {
      ok: true,
      data: rows.map((row) => ({
        ...row.pass,
        visitorName: `${row.visitorName} ${row.visitorLastName ?? ''}`.trim(),
        affiliationName: row.affiliationName,
      })),
    };
  });

  app.post('/v1/passes', { preHandler: [staff, requireFeature(db, 'cross_training')] }, async (request, reply) => {
    const { academyId } = auth(request);
    const body = await parseJsonBody(request, crossTrainingPassSchema);
    const visitor = db.select().from(users)
      .where(and(eq(users.id, body.visitorId), eq(users.academyId, academyId))).get();
    if (!visitor) throw notFound('Visitor not found');
    if (body.affiliationId) {
      const affiliation = db.select().from(affiliations)
        .where(and(eq(affiliations.id, body.affiliationId), eq(affiliations.academyId, academyId))).get();
      if (!affiliation) throw notFound('Affiliation not found');
      if (!affiliation.verifiedAt) throw unprocessable('Affiliation has not been verified');
    }
    const id = uuidv7();
    db.insert(crossTrainingPasses).values({
      id,
      academyId,
      userId: body.visitorId,
      affiliationId: body.affiliationId,
      passDate: body.passDate,
      notes: body.notes,
      qrToken: `pass_${randomToken(18)}`,
      status: 'approved',
    }).run();
    return reply.code(201).send({
      ok: true,
      data: { id, qrToken: db.select({ token: crossTrainingPasses.qrToken }).from(crossTrainingPasses).where(eq(crossTrainingPasses.id, id)).get()!.token },
    });
  });

  app.post('/v1/passes/:id/waiver', { preHandler: staff }, async (request) => {
    const { academyId } = auth(request);
    const { id } = request.params as { id: string };
    const body = await parseJsonBody(request, linkWaiverSchema);
    const pass = db.select().from(crossTrainingPasses)
      .where(and(eq(crossTrainingPasses.id, id), eq(crossTrainingPasses.academyId, academyId))).get();
    if (!pass) throw notFound('Pass not found');
    const waiver = db.select().from(waivers)
      .where(and(eq(waivers.id, body.waiverId), eq(waivers.academyId, academyId), eq(waivers.userId, pass.userId)))
      .get();
    if (!waiver) throw badRequest('Waiver must belong to the pass visitor');
    db.update(crossTrainingPasses).set({ waiverId: waiver.id }).where(eq(crossTrainingPasses.id, id)).run();
    return { ok: true, data: { id, waiverId: waiver.id } };
  });

  app.post('/v1/passes/:id/check-in', { preHandler: staff }, async (request) => {
    const { academyId } = auth(request);
    const { id } = request.params as { id: string };
    const body = await parseJsonBody(request, passCheckInSchema);

    const replay = db.select().from(appliedMutations)
      .where(eq(appliedMutations.mutationId, body.mutationId)).get();
    if (replay) return { ok: true, data: replay.resultJson };

    const pass = db.select().from(crossTrainingPasses)
      .where(and(eq(crossTrainingPasses.id, id), eq(crossTrainingPasses.academyId, academyId))).get();
    if (!pass) throw notFound('Pass not found');
    if (pass.status === 'checked_in') throw conflict('This pass was already used');
    if (pass.status !== 'approved') throw unprocessable('Pass is not approved');

    const validWaiver = db.select({ id: waivers.id }).from(waivers)
      .where(and(
        eq(waivers.academyId, academyId),
        eq(waivers.userId, pass.userId),
        eq(waivers.status, 'signed'),
        or(isNull(waivers.expiresAt), gte(waivers.expiresAt, new Date().toISOString())),
      ))
      .get();
    if (!validWaiver) {
      throw unprocessable('A signed waiver is required before a visiting grappler steps on the mat', {
        visitorId: pass.userId,
      });
    }

    const targetClass = db.select().from(classes)
      .where(and(eq(classes.id, body.classId), eq(classes.academyId, academyId))).get();
    if (!targetClass) throw notFound('Class not found');

    const attendanceId = uuidv7();
    const hlc = serverClock.tick();
    const result = {
      attendanceId,
      userId: pass.userId,
      status: 'checked_in' as const,
      checkedInAt: body.checkedInAt,
      synced: true,
      warnings: ['Cross-training visitor'],
    };

    db.transaction((tx) => {
      tx.insert(attendanceLogs).values({
        id: attendanceId,
        academyId,
        classId: targetClass.id,
        userId: pass.userId,
        checkedInAt: body.checkedInAt,
        method: 'qr',
        status: 'checked_in',
        kioskId: body.deviceId,
        hlc,
        originDeviceId: body.deviceId,
        syncStatus: 'synced',
        mutationId: body.mutationId,
        syncedAt: new Date().toISOString(),
        version: 1,
      }).run();
      tx.update(classes)
        .set({ checkedInCount: targetClass.checkedInCount + 1 })
        .where(eq(classes.id, targetClass.id)).run();
      tx.update(crossTrainingPasses)
        .set({ status: 'checked_in', checkedInAt: body.checkedInAt, waiverId: validWaiver.id })
        .where(eq(crossTrainingPasses.id, id)).run();
      recordChange(tx, {
        academyId,
        entity: 'attendance_log',
        entityId: attendanceId,
        operation: 'insert',
        payload: { classId: targetClass.id, userId: pass.userId, method: 'qr' },
        originDeviceId: body.deviceId,
      });
      tx.insert(appliedMutations).values({
        mutationId: body.mutationId,
        academyId,
        deviceId: body.deviceId,
        entity: 'attendance_log',
        entityId: attendanceId,
        resultJson: result as unknown as Record<string, unknown>,
      }).onConflictDoNothing().run();
    });

    return { ok: true, data: result };
  });

  // ------------------------------------------------------------- public QR
  app.get('/v1/passes/public/:token', async (request) => {
    const { token } = request.params as { token: string };
    const pass = db.select().from(crossTrainingPasses)
      .where(eq(crossTrainingPasses.qrToken, token)).get();
    if (!pass) throw notFound('Pass not found');
    const visitor = db.select().from(users).where(eq(users.id, pass.userId)).get();
    const academy = db.select().from(affiliations)
      .where(eq(affiliations.id, pass.affiliationId ?? '')).get();
    const validWaiver = db.select({ id: waivers.id, expiresAt: waivers.expiresAt }).from(waivers)
      .where(and(eq(waivers.academyId, pass.academyId), eq(waivers.userId, pass.userId), eq(waivers.status, 'signed')))
      .orderBy(asc(waivers.signedAt))
      .get();
    const waiverRequired = !validWaiver || (validWaiver.expiresAt ? Date.parse(validWaiver.expiresAt) < Date.now() : false);
    return {
      ok: true,
      data: {
        passId: pass.id,
        status: pass.status,
        passDate: pass.passDate,
        visitorName: visitor ? `${visitor.firstName} ${visitor.lastName}` : 'Visitor',
        affiliationName: academy?.name ?? null,
        waiverRequired,
        waiverSignUrl: waiverRequired
          ? `/waiver?academy=${pass.academyId}&type=dropin&pass=${pass.id}`
          : null,
      },
    };
  });
}
