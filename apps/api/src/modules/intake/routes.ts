import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { incidents, leads, memberships, users, type Db } from '@gymlytics/db';
import {
  createIncidentSchema,
  createLeadSchema,
  updateIncidentSchema,
  updateLeadSchema,
} from '@gymlytics/shared';
import { auth, requireRole } from '../../lib/auth';
import { parseJsonBody } from '../../lib/crypto';
import { badRequest, notFound } from '../../lib/errors';
import { uuidv7 } from '../../lib/ids';

/**
 * Capture endpoints for the two analytics facts that cannot be derived from
 * operational tables: acquisition leads and safety incidents.
 */
export async function registerIntakeRoutes(app: FastifyInstance, db: Db): Promise<void> {
  const staff = requireRole('owner', 'admin', 'coach', 'staff');
  const listQuery = (value: unknown) => {
    const params = (value ?? {}) as Record<string, string | undefined>;
    return {
      limit: Math.min(500, Math.max(1, Number(params.limit ?? 100) || 100)),
      status: params.status,
      source: params.source,
    };
  };

  app.get('/v1/leads', { preHandler: staff }, async (request) => {
    const { academyId } = auth(request);
    const query = listQuery(request.query);
    const rows = db
      .select()
      .from(leads)
      .where(and(eq(leads.academyId, academyId), isNull(leads.deletedAt)))
      .orderBy(desc(leads.createdAt))
      .limit(query.limit)
      .all()
      .filter((lead) => !query.status || lead.status === query.status)
      .filter((lead) => !query.source || lead.source === query.source);
    return { ok: true, data: rows };
  });

  app.post('/v1/leads', { preHandler: staff }, async (request, reply) => {
    const body = await parseJsonBody(request, createLeadSchema);
    const { academyId } = auth(request);
    if (body.referredByUserId) {
      const referrer = db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, body.referredByUserId), eq(users.academyId, academyId)))
        .get();
      if (!referrer) throw badRequest('Referring member must belong to this academy');
    }
    const id = uuidv7();
    db.insert(leads)
      .values({
        id,
        academyId,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
        source: body.source,
        referredByUserId: body.referredByUserId,
        notes: body.notes,
        trialAttendedAt: body.trialAttendedAt,
        lastContactAt: new Date().toISOString(),
      })
      .run();
    return reply.code(201).send({ ok: true, data: { id } });
  });

  app.patch('/v1/leads/:id', { preHandler: staff }, async (request) => {
    const { academyId } = auth(request);
    const { id } = request.params as { id: string };
    const body = await parseJsonBody(request, updateLeadSchema);
    const lead = db
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.academyId, academyId), isNull(leads.deletedAt)))
      .get();
    if (!lead) throw notFound('Lead not found');
    if (body.convertedMembershipId) {
      const membership = db
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.id, body.convertedMembershipId), eq(memberships.academyId, academyId)))
        .get();
      if (!membership) throw badRequest('Membership must belong to this academy');
    }
    db.update(leads)
      .set({
        ...body,
        ...(body.status === 'converted' && !lead.convertedAt ? { convertedAt: new Date().toISOString() } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(leads.id, id))
      .run();
    return { ok: true, data: { id } };
  });

  app.get('/v1/incidents', { preHandler: staff }, async (request) => {
    const { academyId } = auth(request);
    const query = listQuery(request.query);
    const rows = db
      .select()
      .from(incidents)
      .where(eq(incidents.academyId, academyId))
      .orderBy(desc(incidents.occurredAt))
      .limit(query.limit)
      .all();
    return { ok: true, data: rows };
  });

  app.post('/v1/incidents', { preHandler: staff }, async (request, reply) => {
    const body = await parseJsonBody(request, createIncidentSchema);
    const { academyId, userId } = auth(request);
    const id = uuidv7();
    db.insert(incidents)
      .values({
        id,
        academyId,
        userId: body.userId,
        programId: body.programId,
        classId: body.classId,
        occurredAt: body.occurredAt,
        location: body.location,
        type: body.type,
        severity: body.severity,
        description: body.description,
        actionTaken: body.actionTaken,
        witnessName: body.witnessName,
        followUpRequired: body.followUpRequired,
        reportedByUserId: userId,
        status: body.followUpRequired ? 'follow_up' : 'open',
      })
      .run();
    return reply.code(201).send({ ok: true, data: { id } });
  });

  app.patch('/v1/incidents/:id', { preHandler: staff }, async (request) => {
    const { academyId } = auth(request);
    const { id } = request.params as { id: string };
    const body = await parseJsonBody(request, updateIncidentSchema);
    const incident = db
      .select()
      .from(incidents)
      .where(and(eq(incidents.id, id), eq(incidents.academyId, academyId)))
      .get();
    if (!incident) throw notFound('Incident not found');
    db.update(incidents)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(incidents.id, id))
      .run();
    return { ok: true, data: { id } };
  });
}
