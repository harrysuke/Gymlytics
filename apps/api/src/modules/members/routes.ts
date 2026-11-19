import { and, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  attendanceLogs,
  beltRanks,
  familyLinks,
  memberships,
  membershipPlans,
  programs,
  promotions,
  users,
  waivers,
  type Db,
} from '@gymlytics/db';
import {
  createMemberSchema,
  familyLinkSchema,
  memberListQuerySchema,
  updateMemberSchema,
} from '@gymlytics/shared';
import { auth, requireRole } from '../../lib/auth';
import { recordChange } from '../../lib/change-log';
import { hashPassword, hashPin, parseJsonBody } from '../../lib/crypto';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { uuidv7 } from '../../lib/ids';

const ACTIVE_MEMBERSHIP_STATES = ['active', 'trialing', 'past_due', 'frozen'] as const;

export async function registerMemberRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get('/v1/members', { preHandler: requireRole('owner', 'admin', 'coach', 'staff') }, async (request) => {
    const context = auth(request);
    const query = memberListQuerySchema.parse(request.query);
    const conditions = [eq(users.academyId, context.academyId), isNull(users.deletedAt)];
    if (query.status) conditions.push(eq(users.status, query.status));
    if (query.role) conditions.push(eq(users.role, query.role));
    if (query.q) {
      const needle = `%${query.q}%`;
      conditions.push(
        or(
          like(users.firstName, needle),
          like(users.lastName, needle),
          like(users.email, needle),
          like(users.phone, needle),
        )!,
      );
    }

    const rows = db
      .select({
        user: users,
        membershipId: memberships.id,
        membershipStatus: memberships.status,
        periodEnd: memberships.currentPeriodEnd,
        planName: membershipPlans.name,
        planType: membershipPlans.planType,
      })
      .from(users)
      .leftJoin(
        memberships,
        and(
          eq(memberships.userId, users.id),
          inArray(memberships.status, [...ACTIVE_MEMBERSHIP_STATES]),
        ),
      )
      .leftJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
      .where(and(...conditions))
      .orderBy(desc(users.createdAt))
      .limit(query.limit)
      .offset(Number(query.cursor ?? 0))
      .all();

    const total = db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(and(...conditions))
      .get();

    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.user.id,
        firstName: row.user.firstName,
        lastName: row.user.lastName,
        preferredName: row.user.preferredName,
        email: row.user.email,
        phone: row.user.phone,
        role: row.user.role,
        status: row.user.status,
        dateOfBirth: row.user.dateOfBirth,
        createdAt: row.user.createdAt,
        membership: row.membershipId
          ? {
              id: row.membershipId,
              status: row.membershipStatus,
              periodEnd: row.periodEnd,
              planName: row.planName,
              planType: row.planType,
            }
          : null,
      })),
      meta: { pagination: { total: total?.count ?? 0, limit: query.limit } },
    };
  });

  app.post('/v1/members', { preHandler: requireRole('owner', 'admin', 'staff') }, async (request, reply) => {
    const context = auth(request);
    const body = await parseJsonBody(request, createMemberSchema);
    const email = body.email?.toLowerCase();

    if (email) {
      const existing = db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.academyId, context.academyId), eq(users.email, email)))
        .get();
      if (existing) throw conflict('A member with this email already exists');
    }

    const id = uuidv7();
    const pinHash = body.pin ? hashPin(context.academyId, body.pin) : null;

    const member = db.transaction((tx) => {
      const row = tx
        .insert(users)
        .values({
          id,
          academyId: context.academyId,
          role: body.role,
          status: body.status,
          firstName: body.firstName,
          lastName: body.lastName,
          preferredName: body.preferredName ?? null,
          email: email ?? null,
          phone: body.phone ?? null,
          dateOfBirth: body.dateOfBirth ?? null,
          gender: body.gender ?? null,
          pinHash,
          qrToken: `gym_${uuidv7().replace(/-/g, '')}`,
          notes: body.notes ?? null,
          medicalNotes: body.medicalNotes ?? null,
          emergencyContactName: body.emergencyContactName ?? null,
          emergencyContactPhone: body.emergencyContactPhone ?? null,
        })
        .returning()
        .get();

      for (const guardianId of body.guardianIds ?? []) {
        const guardian = tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, guardianId), eq(users.academyId, context.academyId)))
          .get();
        if (!guardian) throw badRequest(`Guardian ${guardianId} does not belong to this academy`);
        tx.insert(familyLinks)
          .values({
            id: uuidv7(),
            academyId: context.academyId,
            guardianId,
            dependentId: id,
            relationship: 'guardian',
            isPrimaryBilling: true,
            canSignWaivers: true,
            canViewProgress: true,
            canBookClasses: true,
          })
          .run();
      }

      recordChange(tx, {
        academyId: context.academyId,
        entity: 'member',
        entityId: id,
        operation: 'insert',
        payload: memberPayload(row),
      });
      return row;
    });

    return reply.code(201).send({ ok: true, data: { id: member.id } });
  });

  app.get('/v1/members/:id', { preHandler: requireRole('owner', 'admin', 'coach', 'staff') }, async (request) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    const member = db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.academyId, context.academyId), isNull(users.deletedAt)))
      .get();
    if (!member) throw notFound('Member not found');

    const guardians = db
      .select({
        linkId: familyLinks.id,
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        phone: users.phone,
        relationship: familyLinks.relationship,
        isPrimaryBilling: familyLinks.isPrimaryBilling,
        canSignWaivers: familyLinks.canSignWaivers,
      })
      .from(familyLinks)
      .innerJoin(users, eq(familyLinks.guardianId, users.id))
      .where(eq(familyLinks.dependentId, id))
      .all();

    const dependents = db
      .select({
        linkId: familyLinks.id,
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        dateOfBirth: users.dateOfBirth,
        canBookClasses: familyLinks.canBookClasses,
        canSignWaivers: familyLinks.canSignWaivers,
      })
      .from(familyLinks)
      .innerJoin(users, eq(familyLinks.dependentId, users.id))
      .where(eq(familyLinks.guardianId, id))
      .all();

    const memberMemberships = db
      .select({
        id: memberships.id,
        status: memberships.status,
        currentPeriodStart: memberships.currentPeriodStart,
        currentPeriodEnd: memberships.currentPeriodEnd,
        classesUsedInPeriod: memberships.classesUsedInPeriod,
        planId: membershipPlans.id,
        planName: membershipPlans.name,
        planType: membershipPlans.planType,
        priceCents: membershipPlans.priceCents,
      })
      .from(memberships)
      .innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
      .where(eq(memberships.userId, id))
      .orderBy(desc(memberships.createdAt))
      .all();

    const memberWaivers = db
      .select({
        id: waivers.id,
        waiverType: waivers.waiverType,
        documentVersion: waivers.documentVersion,
        signedAt: waivers.signedAt,
        status: waivers.status,
        expiresAt: waivers.expiresAt,
      })
      .from(waivers)
      .where(eq(waivers.userId, id))
      .orderBy(desc(waivers.signedAt))
      .all();

    const memberPromotions = db
      .select({
        id: promotions.id,
        promotedAt: promotions.promotedAt,
        toStripes: promotions.toStripes,
        rankName: beltRanks.name,
        rankColor: beltRanks.colorHex,
        programName: programs.name,
      })
      .from(promotions)
      .innerJoin(beltRanks, eq(beltRanks.id, promotions.toBeltRankId))
      .innerJoin(programs, eq(programs.id, promotions.programId))
      .where(eq(promotions.userId, id))
      .orderBy(desc(promotions.promotedAt))
      .all();

    const attendance = db
      .select({ count: sql<number>`count(*)` })
      .from(attendanceLogs)
      .where(and(eq(attendanceLogs.userId, id), isNull(attendanceLogs.deletedAt)))
      .get();

    return {
      ok: true,
      data: {
        ...member,
        passwordHash: undefined,
        pinHash: member.pinHash ? 'set' : null,
        guardians,
        dependents,
        memberships: memberMemberships,
        waivers: memberWaivers,
        promotions: memberPromotions,
        attendanceCount: attendance?.count ?? 0,
      },
    };
  });

  app.patch('/v1/members/:id', { preHandler: requireRole('owner', 'admin', 'staff') }, async (request) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    const body = await parseJsonBody(request, updateMemberSchema);
    const existing = db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.academyId, context.academyId), isNull(users.deletedAt)))
      .get();
    if (!existing) throw notFound('Member not found');

    const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (body.firstName !== undefined) updates.firstName = body.firstName;
    if (body.lastName !== undefined) updates.lastName = body.lastName;
    if (body.preferredName !== undefined) updates.preferredName = body.preferredName;
    if (body.email !== undefined) updates.email = body.email.toLowerCase();
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.dateOfBirth !== undefined) updates.dateOfBirth = body.dateOfBirth;
    if (body.gender !== undefined) updates.gender = body.gender;
    if (body.role !== undefined) updates.role = body.role;
    if (body.status !== undefined) updates.status = body.status;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.medicalNotes !== undefined) updates.medicalNotes = body.medicalNotes;
    if (body.emergencyContactName !== undefined) updates.emergencyContactName = body.emergencyContactName;
    if (body.emergencyContactPhone !== undefined) updates.emergencyContactPhone = body.emergencyContactPhone;
    if (body.pin !== undefined) updates.pinHash = hashPin(context.academyId, body.pin);

    const updated = db.transaction((tx) => {
      const row = tx.update(users).set(updates).where(eq(users.id, id)).returning().get();
      if (row) {
        recordChange(tx, {
          academyId: context.academyId,
          entity: 'member',
          entityId: id,
          operation: 'update',
          payload: memberPayload(row),
        });
      }
      return row;
    });

    return { ok: true, data: { id: updated?.id ?? id } };
  });

  app.post('/v1/members/:id/pin', { preHandler: requireRole('owner', 'admin', 'staff') }, async (request) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { pin?: string };
    if (!body.pin || !/^\d{4,8}$/.test(body.pin)) throw badRequest('PIN must be 4 to 8 digits');
    const updated = db
      .update(users)
      .set({ pinHash: hashPin(context.academyId, body.pin), updatedAt: new Date().toISOString() })
      .where(and(eq(users.id, id), eq(users.academyId, context.academyId)))
      .returning({ id: users.id })
      .get();
    if (!updated) throw notFound('Member not found');
    return { ok: true, data: { id, pinSet: true } };
  });

  app.post('/v1/members/:id/password', { preHandler: requireRole('owner', 'admin') }, async (request) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { password?: string };
    if (!body.password || body.password.length < 8) throw badRequest('Password must be at least 8 characters');
    const updated = db
      .update(users)
      .set({ passwordHash: hashPassword(body.password), updatedAt: new Date().toISOString() })
      .where(and(eq(users.id, id), eq(users.academyId, context.academyId)))
      .returning({ id: users.id })
      .get();
    if (!updated) throw notFound('Member not found');
    return { ok: true, data: { id, passwordSet: true } };
  });

  app.post('/v1/family-links', { preHandler: requireRole('owner', 'admin', 'staff') }, async (request, reply) => {
    const context = auth(request);
    const body = await parseJsonBody(request, familyLinkSchema);
    const people = db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.academyId, context.academyId), inArray(users.id, [body.guardianId, body.dependentId])))
      .all();
    if (people.length !== 2) throw badRequest('Both guardian and dependent must belong to this academy');
    if (body.guardianId === body.dependentId) throw badRequest('A person cannot be their own guardian');

    const existing = db
      .select({ id: familyLinks.id })
      .from(familyLinks)
      .where(and(eq(familyLinks.guardianId, body.guardianId), eq(familyLinks.dependentId, body.dependentId)))
      .get();
    if (existing) throw conflict('Family link already exists');

    const id = uuidv7();
    db.insert(familyLinks)
      .values({
        id,
        academyId: context.academyId,
        guardianId: body.guardianId,
        dependentId: body.dependentId,
        relationship: body.relationship,
        isPrimaryBilling: body.isPrimaryBilling,
        canSignWaivers: body.canSignWaivers,
        canViewProgress: body.canViewProgress,
        canBookClasses: body.canBookClasses,
      })
      .run();
    return reply.code(201).send({ ok: true, data: { id } });
  });

  app.delete(
    '/v1/family-links/:id',
    { preHandler: requireRole('owner', 'admin', 'staff') },
    async (request) => {
      const context = auth(request);
      const { id } = request.params as { id: string };
      const result = db
        .delete(familyLinks)
        .where(and(eq(familyLinks.id, id), eq(familyLinks.academyId, context.academyId)))
        .run();
      if (result.changes === 0) throw notFound('Family link not found');
      return { ok: true, data: { deleted: true } };
    },
  );
}

function memberPayload(user: typeof users.$inferSelect): Record<string, unknown> {
  return {
    id: user.id,
    academyId: user.academyId,
    firstName: user.firstName,
    lastName: user.lastName,
    preferredName: user.preferredName,
    role: user.role,
    status: user.status,
    dateOfBirth: user.dateOfBirth,
    pinHash: user.pinHash,
    qrToken: user.qrToken,
    phone: user.phone,
    email: user.email,
    updatedAt: user.updatedAt,
  };
}
