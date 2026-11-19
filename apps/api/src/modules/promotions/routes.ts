import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { beltRanks, promotions, users, type Db } from '@gymlytics/db';
import {
  eligibilityQuerySchema,
  promotionInputSchema,
} from '@gymlytics/shared';
import { auth, requireRole } from '../../lib/auth';
import { parseJsonBody } from '../../lib/crypto';
import { badRequest, notFound } from '../../lib/errors';
import { uuidv7 } from '../../lib/ids';
import { computeEligibility } from '../../lib/progression';

export async function registerPromotionRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get(
    '/v1/promotions/eligibility',
    { preHandler: requireRole('owner', 'admin', 'coach') },
    async (request) => {
      const context = auth(request);
      const query = eligibilityQuerySchema.parse(request.query);
      const rows = computeEligibility(db, context.academyId, query.userId, query.programId);
      return { ok: true, data: rows };
    },
  );

  app.get('/v1/me/progression', async (request) => {
    const context = auth(request);
    const rows = computeEligibility(db, context.academyId, context.userId, undefined);
    return {
      ok: true,
      data: rows.map((row) => ({
        programId: row.programId,
        programName: row.programName,
        rankName: row.currentRankName,
        stripes: row.currentStripes,
        nextRankName: row.nextRankName,
        monthsInRank: row.monthsInRank,
        classesSincePromotion: row.classesSincePromotion,
        matHoursSincePromotion: row.matHoursSincePromotion,
        techniquesRequired: row.techniquesRequired,
        techniquesCompleted: row.techniquesCompleted,
        eligible: row.eligible,
        beltEligible: row.beltEligible,
        stripeEligible: row.stripeEligible,
        suggestedAction: row.suggestedAction,
        missing: row.missing,
      })),
    };
  });

  app.post('/v1/promotions', { preHandler: requireRole('owner', 'admin', 'coach') }, async (request, reply) => {
    const context = auth(request);
    const body = await parseJsonBody(request, promotionInputSchema);

    const member = db
      .select({ id: users.id, createdAt: users.createdAt })
      .from(users)
      .where(and(eq(users.id, body.userId), eq(users.academyId, context.academyId)))
      .get();
    if (!member) throw notFound('Member not found');

    const targetRank = db
      .select()
      .from(beltRanks)
      .where(and(eq(beltRanks.id, body.toBeltRankId), eq(beltRanks.programId, body.programId)))
      .get();
    if (!targetRank) throw notFound('Belt rank not found');
    if ((body.toStripes ?? 0) > targetRank.maxStripes) throw badRequest('Too many stripes for this rank');

    const eligibility = computeEligibility(db, context.academyId, body.userId, body.programId)[0];
    const promotedAt = body.promotedAt ?? new Date().toISOString();
    const id = uuidv7();

    db.insert(promotions)
      .values({
        id,
        academyId: context.academyId,
        userId: body.userId,
        programId: body.programId,
        fromBeltRankId: eligibility?.currentRankId ?? null,
        toBeltRankId: body.toBeltRankId,
        fromStripes: eligibility?.currentStripes ?? 0,
        toStripes: body.toStripes,
        promotedAt,
        promotedBy: context.userId,
        classesSincePromotion: eligibility?.classesSincePromotion ?? 0,
        matHoursSincePromotion: eligibility?.matHoursSincePromotion ?? 0,
        notes: body.notes ?? null,
      })
      .run();

    return reply.code(201).send({ ok: true, data: { id } });
  });
}
