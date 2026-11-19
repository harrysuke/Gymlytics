import cors from '@fastify/cors';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import type { Db } from '@gymlytics/db';
import { academies } from '@gymlytics/db';
import { env } from './lib/env';
import { authenticate } from './lib/auth';
import { HttpError } from './lib/errors';
import { registerAttendanceRoutes } from './modules/attendance/routes';
import { registerAuthRoutes } from './modules/auth/routes';
import { registerBillingRoutes } from './modules/billing/routes';
import { registerClassRoutes } from './modules/classes/routes';
import { registerDashboardRoutes } from './modules/dashboard/routes';
import { registerAnalyticsRoutes } from './modules/analytics/routes';
import { registerReportRoutes } from './modules/reports/routes';
import { registerIntakeRoutes } from './modules/intake/routes';
import { registerKioskRoutes } from './modules/kiosk/routes';
import { registerMemberRoutes } from './modules/members/routes';
import { registerProgramRoutes } from './modules/programs/routes';
import { registerPromotionRoutes } from './modules/promotions/routes';
import { registerSyncRoutes } from './modules/sync/routes';
import { registerWaiverRoutes } from './modules/waivers/routes';
import { registerWebhookRoutes } from './modules/webhooks/routes';
import { registerSaasRoutes } from './modules/saas/routes';
import { registerWidgetRoutes } from './modules/widgets/routes';
import { registerCurriculumRoutes } from './modules/curriculum/routes';
import { registerFamilyRoutes } from './modules/family/routes';
import { registerPassRoutes } from './modules/passes/routes';
import { paymentRegistry } from './lib/payments';

export async function buildApp(db: Db) {
  const app = Fastify({
    logger: { level: env.logLevel },
    bodyLimit: 2 * 1024 * 1024, // signed waiver payloads + batch sync
    trustProxy: true,
  });

  await app.register(cors, {
    // Local development is opened from several origins — localhost, 127.0.0.1
    // and the desktop app's preview proxy — and a strict allow-list turns any
    // mismatch into a browser-side "Failed to fetch" with no useful reason.
    // Reflect the caller in dev; production keeps the explicit allow-list.
    origin: env.nodeEnv === 'production' ? env.corsOrigins : true,
    credentials: true,
  });

  // Keep the raw body for provider signature verification; routes Zod-parse it.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        ok: false,
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: { issues: error.issues },
          requestId: request.id,
        },
      });
    }
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
          requestId: request.id,
        },
      });
    }
    request.log.error({ error }, 'unhandled request error');
    return reply.code(500).send({
      ok: false,
      error: { code: 'internal_error', message: 'Something went wrong', requestId: request.id },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      ok: false,
      error: { code: 'not_found', message: `Route ${request.method} ${request.url} not found` },
    }),
  );

  app.get('/health', async () => ({ ok: true, service: 'gymlytics-api' }));
  app.get('/ready', async () => {
    db.select({ id: academies.id }).from(academies).limit(1).all();
    return { ready: true };
  });

  /**
   * Default-deny: every `/v1/*` route requires a valid bearer token unless it is
   * explicitly listed as public. Previously each route had to remember its own
   * `preHandler`, and any GET that forgot one would blow up inside the handler
   * when `auth(request)` found `request.auth` unset. Centralising the hook makes
   * "forgot to authenticate" impossible instead of merely unlikely.
   */
  const PUBLIC_ROUTES = new Set([
    '/v1/auth/login',
    '/v1/auth/refresh',
    '/v1/auth/device',
    '/v1/auth/register',
  ]);

  app.addHook('preHandler', async (request, reply) => {
    const path = (request.url.split('?')[0] ?? '').replace(/\/+$/, '');
    if (!path.startsWith('/v1/')) return;
    if (PUBLIC_ROUTES.has(path)) return;
    if (path.startsWith('/v1/webhooks/')) return; // signature-verified instead
    // Embeddable widgets and QR passes are intentionally token-gated, not
    // session-gated: a third-party site has no logged-in academy user.
    if (path.startsWith('/v1/widgets/public/') || path.startsWith('/v1/passes/public/')) return;
    await authenticate(request, reply);
  });

  await app.register(async (instance) => registerAuthRoutes(instance, db));
  await app.register(async (instance) => registerMemberRoutes(instance, db));
  await app.register(async (instance) => registerProgramRoutes(instance, db));
  await app.register(async (instance) => registerClassRoutes(instance, db));
  await app.register(async (instance) => registerAttendanceRoutes(instance, db));
  await app.register(async (instance) => registerWaiverRoutes(instance, db));
  await app.register(async (instance) => registerBillingRoutes(instance, db, paymentRegistry));
  await app.register(async (instance) => registerPromotionRoutes(instance, db));
  await app.register(async (instance) => registerDashboardRoutes(instance, db));
  await app.register(async (instance) => registerAnalyticsRoutes(instance, db));
  await app.register(async (instance) => registerReportRoutes(instance, db));
  await app.register(async (instance) => registerIntakeRoutes(instance, db));
  await app.register(async (instance) => registerKioskRoutes(instance, db));
  await app.register(async (instance) => registerSyncRoutes(instance, db));
  await app.register(async (instance) => registerWebhookRoutes(instance, db));
  await app.register(async (instance) => registerSaasRoutes(instance, db));
  await app.register(async (instance) => registerWidgetRoutes(instance, db));
  await app.register(async (instance) => registerCurriculumRoutes(instance, db));
  await app.register(async (instance) => registerFamilyRoutes(instance, db));
  await app.register(async (instance) => registerPassRoutes(instance, db));

  return app;
}
