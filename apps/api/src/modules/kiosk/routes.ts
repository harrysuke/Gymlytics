import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  academies,
  classes,
  memberships,
  membershipPlans,
  programs,
  users,
  waivers,
  type Db,
} from '@gymlytics/db';
import type { KioskBootstrap, KioskMember } from '@gymlytics/shared';
import { auth, authenticate } from '../../lib/auth';
import { recordChange } from '../../lib/change-log';
import { parseJsonBody } from '../../lib/crypto';
import { notFound } from '../../lib/errors';
import { serverClock } from '../../lib/hlc';
import { uuidv7 } from '../../lib/ids';

export async function registerKioskRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get('/v1/kiosk/bootstrap', { preHandler: authenticate }, async (request) => {
    const context = auth(request);
    const academy = db
      .select()
      .from(academies)
      .where(and(eq(academies.id, context.academyId), isNull(academies.deletedAt)))
      .get();
    if (!academy) throw notFound('Academy not found');

    const now = new Date();
    const from = new Date(now);
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 7);

    const memberRows = db
      .select()
      .from(users)
      .where(
        and(
          eq(users.academyId, context.academyId),
          isNull(users.deletedAt),
          inArray(users.status, ['active', 'pending_waiver']),
        ),
      )
      .orderBy(asc(users.lastName), asc(users.firstName))
      .all();

    const waiverRows = db
      .select({
        userId: waivers.userId,
        expiresAt: waivers.expiresAt,
        signedAt: waivers.signedAt,
        status: waivers.status,
      })
      .from(waivers)
      .where(
        and(
          eq(waivers.academyId, context.academyId),
          eq(waivers.waiverType, 'general'),
          eq(waivers.status, 'signed'),
        ),
      )
      .orderBy(desc(waivers.signedAt))
      .all();
    const waiverByUser = new Map<string, { expiresAt: string | null; signedAt: string }>();
    for (const row of waiverRows) {
      if (!waiverByUser.has(row.userId)) {
        waiverByUser.set(row.userId, { expiresAt: row.expiresAt, signedAt: row.signedAt });
      }
    }

    const membershipRows = db
      .select({
        userId: memberships.userId,
        status: memberships.status,
        currentPeriodEnd: memberships.currentPeriodEnd,
        classesUsedInPeriod: memberships.classesUsedInPeriod,
        planType: membershipPlans.planType,
        classesPerWeek: membershipPlans.classesPerWeek,
        classPackCount: membershipPlans.classPackCount,
      })
      .from(memberships)
      .innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
      .where(
        and(
          eq(memberships.academyId, context.academyId),
          inArray(memberships.status, ['active', 'trialing', 'past_due', 'frozen']),
        ),
      )
      .orderBy(desc(memberships.createdAt))
      .all();
    const membershipByUser = new Map<string, (typeof membershipRows)[number]>();
    for (const row of membershipRows) {
      if (!membershipByUser.has(row.userId)) membershipByUser.set(row.userId, row);
    }

    const members: KioskMember[] = memberRows.map((member) => {
      const waiver = waiverByUser.get(member.id);
      const membership = membershipByUser.get(member.id);
      const waiverValid = Boolean(
        waiver && (!waiver.expiresAt || new Date(waiver.expiresAt) > now),
      );
      return {
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        preferredName: member.preferredName,
        role: member.role,
        status: member.status,
        dateOfBirth: member.dateOfBirth,
        pinHash: member.pinHash,
        qrToken: member.qrToken,
        waiverValid,
        waiverExpiresAt: waiver?.expiresAt ?? null,
        membershipStatus: membership?.status ?? null,
        membershipPlanType: membership?.planType ?? null,
        membershipPeriodEnd: membership?.currentPeriodEnd ?? null,
        classesUsedInPeriod: membership?.classesUsedInPeriod ?? 0,
        classesPerWeek: membership?.classesPerWeek ?? null,
        classPackCount: membership?.classPackCount ?? null,
      };
    });

    const classRows = db
      .select({
        id: classes.id,
        programId: classes.programId,
        programName: programs.name,
        title: classes.title,
        startsAt: classes.startsAt,
        endsAt: classes.endsAt,
        capacity: classes.capacity,
        bookedCount: classes.bookedCount,
        location: classes.location,
      })
      .from(classes)
      .innerJoin(programs, eq(programs.id, classes.programId))
      .where(
        and(
          eq(classes.academyId, context.academyId),
          isNull(classes.deletedAt),
          gte(classes.startsAt, from.toISOString()),
          lte(classes.startsAt, to.toISOString()),
        ),
      )
      .orderBy(asc(classes.startsAt))
      .all();

    const payload: KioskBootstrap = {
      academy: {
        id: academy.id,
        name: academy.name,
        slug: academy.slug,
        timezone: academy.timezone,
        currency: academy.currency,
        logoUrl: academy.logoUrl,
      },
      members,
      classes: classRows,
      serverHlc: serverClock.tick(),
      generatedAt: new Date().toISOString(),
    };

    return { ok: true, data: payload };
  });

  /**
   * Quick visitor registration. The visitor still needs a signed drop-in
   * waiver and a day pass before the kiosk will check them in.
   */
  app.post('/v1/kiosk/drop-in', { preHandler: authenticate }, async (request, reply) => {
    const context = auth(request);
    const body = await parseJsonBody(
      request,
      z.object({
        firstName: z.string().min(1).max(80),
        lastName: z.string().min(1).max(80),
        phone: z.string().min(6).max(30),
        email: z.string().email().optional(),
        notes: z.string().max(500).optional(),
      }),
    );

    const id = uuidv7();
    const visitor = db.transaction((tx) => {
      const row = tx
        .insert(users)
        .values({
          id,
          academyId: context.academyId,
          role: 'dropin',
          status: 'pending_waiver',
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email?.toLowerCase() ?? null,
          phone: body.phone,
          qrToken: `gym_${uuidv7().replace(/-/g, '')}`,
          notes: body.notes ?? null,
        })
        .returning()
        .get();

      recordChange(tx, {
        academyId: context.academyId,
        entity: 'dropin_user',
        entityId: id,
        operation: 'insert',
        payload: {
          id,
          firstName: row.firstName,
          lastName: row.lastName,
          role: 'dropin',
          status: 'pending_waiver',
          phone: row.phone,
          qrToken: row.qrToken,
        },
      });
      return row;
    });

    return reply.code(201).send({
      ok: true,
      data: { id: visitor.id, firstName: visitor.firstName, lastName: visitor.lastName },
    });
  });
}
