import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  academies,
  familyLinks,
  users,
  WAIVER_TYPES,
  waiverTemplates,
  waivers,
  type Db,
} from '@gymlytics/db';
import {
  createWaiverTemplateSchema,
  signWaiverSchema,
} from '@gymlytics/shared';
import { auth, requireRole } from '../../lib/auth';
import { recordChange } from '../../lib/change-log';
import { parseJsonBody, sha256Hex } from '../../lib/crypto';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { uuidv7 } from '../../lib/ids';
import { renderWaiverPdf } from '../../lib/waiver-pdf';

export async function registerWaiverRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get('/v1/waivers/templates', async (request) => {
    const context = auth(request);
    const query = request.query as { type?: string };
    const conditions = [eq(waiverTemplates.academyId, context.academyId), eq(waiverTemplates.isActive, true)];
    if (query.type) {
      conditions.push(
        eq(
          waiverTemplates.waiverType,
          query.type as 'general' | 'participation' | 'photo_release' | 'medical' | 'dropin',
        ),
      );
    }
    const rows = db
      .select()
      .from(waiverTemplates)
      .where(and(...conditions))
      .orderBy(desc(waiverTemplates.version))
      .all();
    return { ok: true, data: rows };
  });

  app.post('/v1/waiver-templates', { preHandler: requireRole('owner', 'admin') }, async (request, reply) => {
    const context = auth(request);
    const body = await parseJsonBody(request, createWaiverTemplateSchema);
    const existing = db
      .select({ id: waiverTemplates.id })
      .from(waiverTemplates)
      .where(
        and(
          eq(waiverTemplates.academyId, context.academyId),
          eq(waiverTemplates.waiverType, body.waiverType),
          eq(waiverTemplates.version, body.version),
        ),
      )
      .get();
    if (existing) throw conflict('This waiver version already exists');

    const id = uuidv7();
    db.insert(waiverTemplates)
      .values({
        id,
        academyId: context.academyId,
        waiverType: body.waiverType,
        version: body.version,
        title: body.title,
        bodyMarkdown: body.bodyMarkdown,
        documentHash: sha256Hex(body.bodyMarkdown),
      })
      .run();
    return reply.code(201).send({ ok: true, data: { id, documentHash: sha256Hex(body.bodyMarkdown) } });
  });

  app.post('/v1/waivers', async (request, reply) => {
    const context = auth(request);
    const body = await parseJsonBody(request, signWaiverSchema);
    if (body.academyId !== context.academyId) throw forbidden('Cross-academy waiver denied');

    const member = db
      .select()
      .from(users)
      .where(and(eq(users.id, body.userId), eq(users.academyId, context.academyId), isNull(users.deletedAt)))
      .get();
    if (!member) throw notFound('Member not found');

    const template = db
      .select()
      .from(waiverTemplates)
      .where(
        and(
          eq(waiverTemplates.academyId, context.academyId),
          eq(waiverTemplates.waiverType, body.waiverType),
          eq(waiverTemplates.version, body.documentVersion),
          eq(waiverTemplates.isActive, true),
        ),
      )
      .get();
    if (!template) throw unprocessable('This waiver version is not available');
    if (template.documentHash !== body.documentHash) {
      throw unprocessable('The document changed while it was open — reload and sign again');
    }

    const dateOfBirth = body.dateOfBirth ?? member.dateOfBirth;
    const age = dateOfBirth ? ageInYears(dateOfBirth) : null;
    if (age !== null && age < 18) {
      if (!body.guardianUserId) throw unprocessable('A guardian must sign for a minor');
      const link = db
        .select({ id: familyLinks.id, canSignWaivers: familyLinks.canSignWaivers })
        .from(familyLinks)
        .where(
          and(
            eq(familyLinks.guardianId, body.guardianUserId),
            eq(familyLinks.dependentId, member.id),
          ),
        )
        .get();
      if (!link || !link.canSignWaivers) throw forbidden('This guardian cannot sign for the member');
    }

    const existing = db
      .select({ id: waivers.id })
      .from(waivers)
      .where(
        and(
          eq(waivers.userId, member.id),
          eq(waivers.waiverType, body.waiverType),
          eq(waivers.documentVersion, body.documentVersion),
        ),
      )
      .get();
    if (existing) {
      return { ok: true, data: { id: existing.id, pdfUrl: `/v1/waivers/${existing.id}/pdf`, duplicate: true } };
    }

    const id = uuidv7();
    const now = new Date().toISOString();
    const expiresAt =
      body.waiverType === 'dropin'
        ? new Date(Date.now() + 86_400_000).toISOString()
        : new Date(Date.now() + 365 * 86_400_000).toISOString();

    db.transaction((tx) => {
      tx.insert(waivers)
        .values({
          id,
          academyId: context.academyId,
          userId: member.id,
          programId: body.programId ?? null,
          waiverType: body.waiverType,
          documentVersion: body.documentVersion,
          documentTitle: template.title,
          documentHash: body.documentHash,
          signatureData: body.signatureData,
          signatureFormat: body.signatureFormat,
          signerName: body.signerName,
          signerIp: request.ip,
          userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
          signedAt: body.signedAt,
          dateOfBirthSnapshot: dateOfBirth ?? null,
          guardianUserId: body.guardianUserId ?? null,
          status: 'signed',
          expiresAt,
          hlc: body.hlc,
          mutationId: body.mutationId,
          syncStatus: 'synced',
        })
        .run();

      recordChange(tx, {
        academyId: context.academyId,
        entity: 'waiver',
        entityId: id,
        operation: 'insert',
        payload: {
          id,
          academyId: context.academyId,
          userId: member.id,
          waiverType: body.waiverType,
          documentVersion: body.documentVersion,
          signatureData: body.signatureData,
          signatureFormat: body.signatureFormat,
          signerName: body.signerName,
          signedAt: body.signedAt,
          status: 'signed',
          expiresAt,
          version: 1,
        },
        originDeviceId: body.hlc.split('-').pop() ?? 'server',
      });
    });

    return reply.code(201).send({ ok: true, data: { id, pdfUrl: `/v1/waivers/${id}/pdf` } });
  });

  app.get('/v1/waivers/requirements/:userId', async (request) => {
    const context = auth(request);
    const { userId } = request.params as { userId: string };
    const query = request.query as { waiverType?: string };
    const type = toWaiverType(query.waiverType);

    const waiver = db
      .select()
      .from(waivers)
      .where(and(eq(waivers.userId, userId), eq(waivers.waiverType, type), eq(waivers.status, 'signed')))
      .orderBy(desc(waivers.signedAt))
      .limit(1)
      .get();

    const satisfied =
      Boolean(waiver) &&
      (!waiver?.expiresAt || new Date(waiver.expiresAt) > new Date()) &&
      waiver?.academyId === context.academyId;

    return {
      ok: true,
      data: {
        userId,
        waiverType: type,
        satisfied,
        signedAt: waiver?.signedAt,
        expiresAt: waiver?.expiresAt,
        documentVersion: waiver?.documentVersion,
      },
    };
  });

  app.get('/v1/waivers', async (request) => {
    const context = auth(request);
    const query = request.query as { userId?: string; status?: string; waiverType?: string; limit?: string };
    const canReadOthers = ['owner', 'admin', 'coach', 'staff'].includes(context.role);

    // No `userId` from staff means "the whole academy" — that is what the waiver
    // register in the admin console asks for. Everyone else is pinned to self.
    const userId = query.userId ?? (canReadOthers ? undefined : context.userId);
    if (userId && userId !== context.userId && !canReadOthers) throw forbidden();

    const conditions = [eq(waivers.academyId, context.academyId)];
    if (userId) conditions.push(eq(waivers.userId, userId));
    if (query.status) conditions.push(eq(waivers.status, query.status as 'signed'));
    if (query.waiverType) conditions.push(eq(waivers.waiverType, toWaiverType(query.waiverType)));

    const rows = db
      .select({
        id: waivers.id,
        userId: waivers.userId,
        memberFirstName: users.firstName,
        memberLastName: users.lastName,
        waiverType: waivers.waiverType,
        documentVersion: waivers.documentVersion,
        documentTitle: waivers.documentTitle,
        signedAt: waivers.signedAt,
        expiresAt: waivers.expiresAt,
        status: waivers.status,
        signerName: waivers.signerName,
      })
      .from(waivers)
      .leftJoin(users, eq(users.id, waivers.userId))
      .where(and(...conditions))
      .orderBy(desc(waivers.signedAt))
      .limit(Math.min(Number(query.limit ?? 100), 500))
      .all();
    return { ok: true, data: rows };
  });

  app.get('/v1/waivers/:id/pdf', async (request, reply) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    const waiver = db
      .select()
      .from(waivers)
      .where(and(eq(waivers.id, id), eq(waivers.academyId, context.academyId)))
      .get();
    if (!waiver) throw notFound('Waiver not found');

    const member = db.select().from(users).where(eq(users.id, waiver.userId)).get();
    const academy = db.select().from(academies).where(eq(academies.id, waiver.academyId)).get();
    const template = db
      .select()
      .from(waiverTemplates)
      .where(
        and(
          eq(waiverTemplates.academyId, waiver.academyId),
          eq(waiverTemplates.waiverType, waiver.waiverType),
          eq(waiverTemplates.version, waiver.documentVersion),
        ),
      )
      .get();
    const guardian = waiver.guardianUserId
      ? db.select().from(users).where(eq(users.id, waiver.guardianUserId)).get()
      : null;

    const bytes = await renderWaiverPdf({
      academyName: academy?.name ?? 'Gymlytics Academy',
      title: waiver.documentTitle,
      bodyMarkdown: template?.bodyMarkdown ?? 'Signed waiver.',
      memberName: member ? `${member.firstName} ${member.lastName}` : waiver.signerName,
      signerName: waiver.signerName,
      signedAt: waiver.signedAt,
      signerIp: waiver.signerIp,
      documentVersion: waiver.documentVersion,
      documentHash: waiver.documentHash,
      dateOfBirth: waiver.dateOfBirthSnapshot,
      guardianName: guardian ? `${guardian.firstName} ${guardian.lastName}` : null,
      signatureData: waiver.signatureData,
      signatureFormat: waiver.signatureFormat,
    });

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="waiver-${waiver.id}.pdf"`)
      .send(Buffer.from(bytes));
  });
}

function ageInYears(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return 0;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const month = now.getUTCMonth() - dob.getUTCMonth();
  if (month < 0 || (month === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

/** Narrow an untrusted query-string value to a known waiver type. */
function toWaiverType(value: string | undefined): (typeof WAIVER_TYPES)[number] {
  const found = WAIVER_TYPES.find((candidate) => candidate === value);
  return found ?? 'general';
}
