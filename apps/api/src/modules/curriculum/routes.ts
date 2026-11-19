import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  attendanceLogs,
  classRecaps,
  classes,
  curriculumVideos,
  users,
  type Db,
} from '@gymlytics/db';
import { classRecapSchema, curriculumVideoSchema } from '@gymlytics/shared';
import { auth, requireRole } from '../../lib/auth';
import { parseJsonBody } from '../../lib/crypto';
import { notFound } from '../../lib/errors';
import { uuidv7 } from '../../lib/ids';

export async function registerCurriculumRoutes(app: FastifyInstance, db: Db): Promise<void> {
  const coach = requireRole('owner', 'admin', 'coach');

  app.get('/v1/curriculum/videos', async (request) => {
    const { academyId } = auth(request);
    const query = (request.query ?? {}) as { beltSlug?: string; programId?: string };
    const rows = db.select()
      .from(curriculumVideos)
      .where(and(
        eq(curriculumVideos.academyId, academyId),
        eq(curriculumVideos.published, true),
        ...(query.beltSlug ? [eq(curriculumVideos.beltSlug, query.beltSlug)] : []),
        ...(query.programId ? [eq(curriculumVideos.programId, query.programId)] : []),
      ))
      .orderBy(asc(curriculumVideos.sortOrder), asc(curriculumVideos.createdAt))
      .all();
    return { ok: true, data: rows };
  });

  app.post('/v1/curriculum/videos', { preHandler: coach }, async (request, reply) => {
    const { academyId, userId } = auth(request);
    const body = await parseJsonBody(request, curriculumVideoSchema);
    const id = uuidv7();
    db.insert(curriculumVideos).values({
      id,
      academyId,
      createdByUserId: userId,
      programId: body.programId,
      beltSlug: body.beltSlug,
      title: body.title,
      description: body.description,
      url: body.url,
      thumbnailUrl: body.thumbnailUrl,
      durationSeconds: body.durationSeconds,
      sortOrder: body.sortOrder,
      published: body.published,
    }).run();
    return reply.code(201).send({ ok: true, data: { id } });
  });

  app.delete('/v1/curriculum/videos/:id', { preHandler: coach }, async (request) => {
    const { academyId } = auth(request);
    const { id } = request.params as { id: string };
    const result = db.delete(curriculumVideos)
      .where(and(eq(curriculumVideos.id, id), eq(curriculumVideos.academyId, academyId))).run();
    if (!result.changes) throw notFound('Video not found');
    return { ok: true, data: { id } };
  });

  app.get('/v1/classes/:id/recap', async (request) => {
    const { academyId } = auth(request);
    const { id } = request.params as { id: string };
    const row = db.select()
      .from(classRecaps)
      .where(and(eq(classRecaps.classId, id), eq(classRecaps.academyId, academyId)))
      .get();
    if (!row) return { ok: true, data: null };
    const coachUser = row.coachId
      ? db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, row.coachId)).get()
      : null;
    return {
      ok: true,
      data: {
        ...row,
        coachName: coachUser ? `${coachUser.firstName} ${coachUser.lastName}` : null,
      },
    };
  });

  app.put('/v1/classes/:id/recap', { preHandler: coach }, async (request, reply) => {
    const { academyId, userId } = auth(request);
    const { id } = request.params as { id: string };
    const target = db.select().from(classes)
      .where(and(eq(classes.id, id), eq(classes.academyId, academyId))).get();
    if (!target) throw notFound('Class not found');

    const body = await parseJsonBody(request, classRecapSchema);
    const existing = db.select().from(classRecaps)
      .where(and(eq(classRecaps.classId, id), eq(classRecaps.academyId, academyId))).get();
    if (existing) {
      db.update(classRecaps).set({
        summary: body.summary,
        videoUrl: body.videoUrl,
        techniques: body.techniques,
        coachId: userId,
        updatedAt: new Date().toISOString(),
      }).where(eq(classRecaps.id, existing.id)).run();
      return { ok: true, data: { id: existing.id } };
    }
    const recapId = uuidv7();
    db.insert(classRecaps).values({
      id: recapId,
      academyId,
      classId: id,
      coachId: userId,
      summary: body.summary,
      videoUrl: body.videoUrl,
      techniques: body.techniques,
    }).run();
    return reply.code(201).send({ ok: true, data: { id: recapId } });
  });

  /** Recaps for sessions the caller actually attended — no cross-member leakage. */
  app.get('/v1/me/recaps', async (request) => {
    const { academyId, userId } = auth(request);
    const attended = db
      .select({ classId: attendanceLogs.classId })
      .from(attendanceLogs)
      .where(and(
        eq(attendanceLogs.academyId, academyId),
        eq(attendanceLogs.userId, userId),
        isNull(attendanceLogs.deletedAt),
      ))
      .all()
      .map((row) => row.classId);
    if (attended.length === 0) return { ok: true, data: [] };
    const rows = db.select({
      recap: classRecaps,
      classTitle: classes.title,
      startsAt: classes.startsAt,
    })
      .from(classRecaps)
      .innerJoin(classes, eq(classRecaps.classId, classes.id))
      .where(and(eq(classRecaps.academyId, academyId), inArray(classRecaps.classId, attended)))
      .orderBy(asc(classes.startsAt))
      .all();
    return { ok: true, data: rows.map((row) => ({ ...row.recap, classTitle: row.classTitle, startsAt: row.startsAt })) };
  });
}
