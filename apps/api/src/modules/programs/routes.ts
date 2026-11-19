import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  beltRanks,
  curriculumRequirements,
  curriculumTechniques,
  programs,
  type Db,
} from '@gymlytics/db';
import {
  IBJJF_ADULT_BELTS,
  IBJJF_KIDS_BELTS,
  createBeltRankSchema,
  createProgramSchema,
  createTechniqueSchema,
  techniqueRequirementSchema,
} from '@gymlytics/shared';
import { auth, requireRole } from '../../lib/auth';
import { conflict, notFound } from '../../lib/errors';
import { uuidv7 } from '../../lib/ids';
import { parseJsonBody } from '../../lib/crypto';

export async function registerProgramRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get('/v1/programs', { preHandler: requireRole('owner', 'admin', 'coach', 'staff', 'student', 'guardian') }, async (request) => {
    const context = auth(request);
    const rows = db
      .select()
      .from(programs)
      .where(and(eq(programs.academyId, context.academyId), isNull(programs.deletedAt)))
      .orderBy(asc(programs.name))
      .all();

    const ranks = db
      .select()
      .from(beltRanks)
      .where(and(eq(beltRanks.academyId, context.academyId), eq(beltRanks.isActive, true)))
      .orderBy(asc(beltRanks.orderIndex))
      .all();

    return {
      ok: true,
      data: rows.map((program) => ({
        ...program,
        ranks: ranks.filter((rank) => rank.programId === program.id),
      })),
    };
  });

  app.post('/v1/programs', { preHandler: requireRole('owner', 'admin') }, async (request, reply) => {
    const context = auth(request);
    const body = await parseJsonBody(request, createProgramSchema);
    const slug = slugify(body.name);
    const existing = db
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.academyId, context.academyId), eq(programs.slug, slug)))
      .get();
    if (existing) throw conflict('A program with this name already exists');

    const id = uuidv7();
    db.transaction((tx) => {
      tx.insert(programs)
        .values({
          id,
          academyId: context.academyId,
          name: body.name,
          slug,
          discipline: body.discipline,
          description: body.description ?? null,
          ageGroup: body.ageGroup,
          defaultCapacity: body.defaultCapacity,
          colorHex: body.colorHex ?? '#1D4ED8',
        })
        .run();

      // Seed a sensible belt ladder so a new academy can run a class today.
      const ladder =
        body.discipline === 'kids_bjj'
          ? IBJJF_KIDS_BELTS
          : ['gi_bjj', 'nogi_bjj', 'judo', 'kyokushin_karate'].includes(body.discipline)
            ? IBJJF_ADULT_BELTS
            : [];
      for (const belt of ladder) {
        tx.insert(beltRanks)
          .values({
            id: uuidv7(),
            academyId: context.academyId,
            programId: id,
            name: belt.name,
            slug: belt.slug,
            system: body.discipline === 'kids_bjj' ? 'ibjjf_kids' : 'ibjjf_adult',
            orderIndex: belt.order,
            maxStripes: body.discipline === 'kids_bjj' ? 4 : 4,
            minMonthsInRank: 0,
            minClassesInRank: 0,
            minMatHours: 0,
            colorHex: belt.color,
            stripeColorHex: '#111827',
          })
          .run();
      }
    });

    return reply.code(201).send({ ok: true, data: { id, slug } });
  });

  app.post('/v1/programs/:id/ranks', { preHandler: requireRole('owner', 'admin', 'coach') }, async (request, reply) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    const program = db
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.id, id), eq(programs.academyId, context.academyId)))
      .get();
    if (!program) throw notFound('Program not found');

    const body = await parseJsonBody(request, createBeltRankSchema);
    const slug = body.slug ?? slugify(body.name);
    const existing = db
      .select({ id: beltRanks.id })
      .from(beltRanks)
      .where(and(eq(beltRanks.programId, id), eq(beltRanks.slug, slug)))
      .get();
    if (existing) throw conflict('This rank already exists in the program');

    const rankId = uuidv7();
    db.insert(beltRanks)
      .values({
        id: rankId,
        academyId: context.academyId,
        programId: id,
        name: body.name,
        slug,
        system: body.system,
        orderIndex: body.orderIndex,
        maxStripes: body.maxStripes,
        minMonthsInRank: body.minMonthsInRank,
        minClassesInRank: body.minClassesInRank,
        minMatHours: body.minMatHours,
        colorHex: body.colorHex ?? '#FFFFFF',
        stripeColorHex: body.stripeColorHex ?? '#111827',
      })
      .run();
    return reply.code(201).send({ ok: true, data: { id: rankId } });
  });

  app.get('/v1/programs/:id/techniques', { preHandler: requireRole('owner', 'admin', 'coach', 'staff') }, async (request) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    const rows = db
      .select()
      .from(curriculumTechniques)
      .where(
        and(eq(curriculumTechniques.programId, id), eq(curriculumTechniques.academyId, context.academyId)),
      )
      .orderBy(asc(curriculumTechniques.name))
      .all();
    return { ok: true, data: rows };
  });

  app.post('/v1/programs/:id/techniques', { preHandler: requireRole('owner', 'admin', 'coach') }, async (request, reply) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    const body = await parseJsonBody(request, createTechniqueSchema);
    const slug = slugify(body.name);
    const existing = db
      .select({ id: curriculumTechniques.id })
      .from(curriculumTechniques)
      .where(and(eq(curriculumTechniques.programId, id), eq(curriculumTechniques.slug, slug)))
      .get();
    if (existing) throw conflict('This technique already exists in the program');

    const techniqueId = uuidv7();
    db.insert(curriculumTechniques)
      .values({
        id: techniqueId,
        academyId: context.academyId,
        programId: id,
        name: body.name,
        slug,
        category: body.category,
        description: body.description ?? null,
        videoUrl: body.videoUrl ?? null,
      })
      .run();
    return reply.code(201).send({ ok: true, data: { id: techniqueId } });
  });

  app.post('/v1/curriculum-requirements', { preHandler: requireRole('owner', 'admin', 'coach') }, async (request, reply) => {
    const context = auth(request);
    const body = await parseJsonBody(request, techniqueRequirementSchema);
    const id = uuidv7();
    db.insert(curriculumRequirements)
      .values({
        id,
        academyId: context.academyId,
        beltRankId: body.beltRankId,
        techniqueId: body.techniqueId,
        requiredStripeLevel: body.requiredStripeLevel,
        isRequired: body.isRequired,
      })
      .onConflictDoNothing()
      .run();
    return reply.code(201).send({ ok: true, data: { id } });
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
