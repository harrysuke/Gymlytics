import { and, asc, eq, gte, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  beltRanks,
  bookings,
  classes,
  familyLinks,
  memberships,
  promotions,
  users,
  type Db,
} from '@gymlytics/db';
import { auth } from '../../lib/auth';
import { forbidden, notFound } from '../../lib/errors';
import { computeEligibility } from '../../lib/progression';

/**
 * Guardian surface. A guardian may only read children linked to their own
 * account; staff may inspect a child's schedule for front-desk help.
 */
function assertGuardianAccess(
  db: Db,
  academyId: string,
  guardianId: string,
  role: string,
  dependentId: string,
) {
  if (!['owner', 'admin', 'coach', 'staff'].includes(role)) {
    const link = db.select().from(familyLinks)
      .where(and(
        eq(familyLinks.academyId, academyId),
        eq(familyLinks.guardianId, guardianId),
        eq(familyLinks.dependentId, dependentId),
      ))
      .get();
    if (!link || !link.canViewProgress) throw forbidden('This child is not linked to your account');
  }
}

export async function registerFamilyRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get('/v1/family/dependents', async (request) => {
    // Guards are role-based above; for guardians we scope by their own id.
    const context = auth(request);
    const isStaff = ['owner', 'admin', 'coach', 'staff'].includes(context.role);
    const links = db.select()
      .from(familyLinks)
      .where(and(
        eq(familyLinks.academyId, context.academyId),
        ...(isStaff ? [] : [eq(familyLinks.guardianId, context.userId)]),
      ))
      .all()
      .filter((link) => isStaff || link.canViewProgress);

    return {
      ok: true,
      data: links.map((link) => {
        const child = db.select().from(users).where(eq(users.id, link.dependentId)).get();
        const membership = db.select().from(memberships)
          .where(and(eq(memberships.userId, link.dependentId)))
          .orderBy(asc(memberships.createdAt))
          .get();
        return {
          id: child?.id ?? link.dependentId,
          firstName: child?.firstName ?? '',
          lastName: child?.lastName ?? '',
          avatarUrl: child?.avatarUrl ?? null,
          relationship: link.relationship,
          canBookClasses: link.canBookClasses,
          canSignWaivers: link.canSignWaivers,
          membershipStatus: membership?.status ?? null,
        };
      }),
    };
  });

  app.get('/v1/family/dependents/:id/schedule', async (request) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    assertGuardianAccess(db, context.academyId, context.userId, context.role, id);

    const rows = db.select({
      bookingId: bookings.id,
      bookingStatus: bookings.status,
      classId: classes.id,
      title: classes.title,
      startsAt: classes.startsAt,
      endsAt: classes.endsAt,
      coachId: classes.coachId,
      spotsLeft: classes.capacity,
      bookedCount: classes.bookedCount,
    })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .where(and(
        eq(bookings.academyId, context.academyId),
        eq(bookings.userId, id),
        gte(classes.startsAt, new Date().toISOString()),
      ))
      .orderBy(asc(classes.startsAt))
      .limit(30)
      .all();
    return {
      ok: true,
      data: rows.map((row) => ({
        ...row,
        spotsLeft: Math.max(0, row.spotsLeft - row.bookedCount),
      })),
    };
  });

  app.get('/v1/family/dependents/:id/progression', async (request) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    assertGuardianAccess(db, context.academyId, context.userId, context.role, id);
    const child = db.select().from(users).where(eq(users.id, id)).get();
    if (!child) throw notFound('Dependent not found');

    const rows = db.select({
      promotion: promotions,
      rankName: beltRanks.name,
      rankColor: beltRanks.colorHex,
    })
      .from(promotions)
      .innerJoin(beltRanks, eq(promotions.toBeltRankId, beltRanks.id))
      .where(and(eq(promotions.academyId, context.academyId), eq(promotions.userId, id)))
      .orderBy(asc(promotions.promotedAt))
      .all();

    return {
      ok: true,
      data: {
        child: { id: child.id, firstName: child.firstName, lastName: child.lastName },
        history: rows.map((row) => ({
          id: row.promotion.id,
          programId: row.promotion.programId,
          rankName: row.rankName,
          rankColor: row.rankColor,
          fromStripes: row.promotion.fromStripes,
          toStripes: row.promotion.toStripes,
          promotedAt: row.promotion.promotedAt,
        })),
        eligibility: computeEligibility(db, context.academyId, id, undefined),
      },
    };
  });
}
