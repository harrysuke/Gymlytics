import { and, asc, eq, gte, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { academies, classes, leads, programs, waiverTemplates, widgets, type Db } from '@gymlytics/db';
import {
  createWidgetSchema,
  publicTrialSchema,
  updateWidgetSchema,
  type WidgetDto,
  type WidgetConfigInput,
} from '@gymlytics/shared';
import { auth, requireRole } from '../../lib/auth';
import { parseJsonBody, randomToken } from '../../lib/crypto';
import { badRequest, notFound } from '../../lib/errors';
import { uuidv7 } from '../../lib/ids';
import { requireFeature } from '../../lib/saas';

const WEB_BASE = process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173';

function toDto(row: typeof widgets.$inferSelect): WidgetDto {
  const config = (row.config ?? {}) as WidgetConfigInput;
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    token: row.token,
    config,
    enabled: row.enabled,
    embedCode: `<iframe src="${WEB_BASE}/embed/${row.kind}/${row.token}" title="${row.label.replaceAll('"', '&quot;')}" width="100%" height="${row.kind === 'schedule' ? 620 : 420}" frameborder="0" loading="lazy"></iframe>`,
  };
}

/** Public widgets are bearer-token-free but scoped to one academy + one kind. */
function resolveWidget(db: Db, token: string, kind?: string) {
  const row = db.select().from(widgets).where(eq(widgets.token, token)).get();
  if (!row || !row.enabled || (kind && row.kind !== kind)) throw notFound('Widget not found');
  return row;
}

export async function registerWidgetRoutes(app: FastifyInstance, db: Db): Promise<void> {
  const ownerAdmin = requireRole('owner', 'admin', 'staff');

  app.get('/v1/widgets', { preHandler: ownerAdmin }, async (request) => {
    const { academyId } = auth(request);
    const rows = db.select().from(widgets).where(eq(widgets.academyId, academyId)).all();
    return { ok: true, data: rows.map(toDto) };
  });

  app.post('/v1/widgets', { preHandler: [ownerAdmin, requireFeature(db, 'widgets')] }, async (request, reply) => {
    const { academyId } = auth(request);
    const body = await parseJsonBody(request, createWidgetSchema);
    const id = uuidv7();
    db.insert(widgets).values({
      id,
      academyId,
      kind: body.kind,
      label: body.label,
      token: `w_${randomToken(18)}`,
      config: body.config,
    }).run();
    return reply.code(201).send({ ok: true, data: toDto(db.select().from(widgets).where(eq(widgets.id, id)).get()!) });
  });

  app.patch('/v1/widgets/:id', { preHandler: ownerAdmin }, async (request) => {
    const { academyId } = auth(request);
    const { id } = request.params as { id: string };
    const existing = db.select().from(widgets)
      .where(and(eq(widgets.id, id), eq(widgets.academyId, academyId))).get();
    if (!existing) throw notFound('Widget not found');
    const body = await parseJsonBody(request, updateWidgetSchema);
    db.update(widgets).set({
      ...(body.label ? { label: body.label } : {}),
      ...(body.kind ? { kind: body.kind } : {}),
      ...(body.config ? { config: body.config } : {}),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      updatedAt: new Date().toISOString(),
    }).where(eq(widgets.id, id)).run();
    return { ok: true, data: toDto(db.select().from(widgets).where(eq(widgets.id, id)).get()!) };
  });

  app.delete('/v1/widgets/:id', { preHandler: ownerAdmin }, async (request) => {
    const { academyId } = auth(request);
    const { id } = request.params as { id: string };
    const result = db.delete(widgets)
      .where(and(eq(widgets.id, id), eq(widgets.academyId, academyId))).run();
    if (!result.changes) throw notFound('Widget not found');
    return { ok: true, data: { id } };
  });

  // --------------------------------------------------------------- public API
  app.get('/v1/widgets/public/:token/schedule', async (request) => {
    const { token } = request.params as { token: string };
    const widget = resolveWidget(db, token, 'schedule');
    const academy = db.select().from(academies).where(eq(academies.id, widget.academyId)).get();
    const limit = Math.min(50, Math.max(1, Number((widget.config as WidgetConfigInput).limit ?? 8)));
    const config = widget.config as WidgetConfigInput;
    const rows = db
      .select({
        id: classes.id,
        title: classes.title,
        startsAt: classes.startsAt,
        endsAt: classes.endsAt,
        spotsLeft: classes.capacity,
        bookedCount: classes.bookedCount,
        programName: programs.name,
      })
      .from(classes)
      .innerJoin(programs, eq(classes.programId, programs.id))
      .where(and(
        eq(classes.academyId, widget.academyId),
        eq(classes.status, 'scheduled'),
        gte(classes.startsAt, new Date().toISOString()),
        ...(config.programId ? [eq(classes.programId, config.programId)] : []),
      ))
      .orderBy(asc(classes.startsAt))
      .limit(limit)
      .all();
    return {
      ok: true,
      data: {
        academyName: academy?.name ?? 'Academy',
        title: config.title ?? 'Class schedule',
        accentColor: config.accentColor ?? '#b91c1c',
        classes: rows.map((row) => ({
          ...row,
          spotsLeft: Math.max(0, row.spotsLeft - row.bookedCount),
        })),
      },
    };
  });

  app.post('/v1/widgets/public/:token/trials', async (request, reply) => {
    const { token } = request.params as { token: string };
    const widget = resolveWidget(db, token, 'trial_form');
    const body = await parseJsonBody(request, publicTrialSchema);
    const id = uuidv7();
    db.insert(leads).values({
      id,
      academyId: widget.academyId,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
      notes: body.notes,
      source: 'website',
      status: 'new',
      lastContactAt: new Date().toISOString(),
    }).run();
    return reply.code(201).send({
      ok: true,
      data: { id, redirectUrl: (widget.config as WidgetConfigInput).redirectUrl ?? null },
    });
  });

  app.get('/v1/widgets/public/:token/waiver', async (request) => {
    const { token } = request.params as { token: string };
    const widget = resolveWidget(db, token, 'waiver_link');
    const template = db.select()
      .from(waiverTemplates)
      .where(and(eq(waiverTemplates.academyId, widget.academyId), eq(waiverTemplates.waiverType, 'dropin')))
      .orderBy(waiverTemplates.version)
      .get();
    if (!template) throw notFound('No active waiver template');
    return {
      ok: true,
      data: {
        title: (widget.config as WidgetConfigInput).title ?? template.title,
        documentTitle: template.title,
        documentHash: template.documentHash,
        signUrl: `${WEB_BASE}/waiver?academy=${widget.academyId}&type=dropin`,
      },
    };
  });
}
