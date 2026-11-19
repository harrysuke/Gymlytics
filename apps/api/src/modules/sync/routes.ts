import { and, asc, eq, gt, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { appliedMutations, syncChanges, syncCursors, type Db } from '@gymlytics/db';
import {
  GENESIS_HLC,
  syncPullQuerySchema,
  syncPushSchema,
  type SyncAck,
} from '@gymlytics/shared';
import { auth, authenticate } from '../../lib/auth';
import { forbidden } from '../../lib/errors';
import { serverClock } from '../../lib/hlc';
import { applyMutation } from './appliers';

export async function registerSyncRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.post('/v1/sync/push', { preHandler: authenticate }, async (request) => {
    const context = auth(request);
    const raw = request.body;
    const body = syncPushSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);

    const acks: SyncAck[] = [];

    for (const mutation of body.mutations) {
      if (mutation.academyId !== context.academyId) {
        acks.push({
          mutationId: mutation.mutationId,
          accepted: false,
          entityId: mutation.entityId,
          serverVersion: mutation.version,
          conflict: true,
          serverHlc: serverClock.tick(),
          reason: 'Cross-academy mutation rejected',
        });
        continue;
      }

      const prior = db
        .select()
        .from(appliedMutations)
        .where(eq(appliedMutations.mutationId, mutation.mutationId))
        .get();
      if (prior) {
        acks.push(prior.resultJson as unknown as SyncAck);
        continue;
      }

      const serverHlc = serverClock.tick();
      let ack: SyncAck;
      try {
        const result = db.transaction((tx) =>
          applyMutation({
            tx,
            academyId: context.academyId,
            deviceId: mutation.deviceId,
            mutation,
            serverHlc,
          }),
        );
        ack = {
          mutationId: mutation.mutationId,
          accepted: !result.conflict,
          entityId: result.entityId,
          serverVersion: mutation.version,
          conflict: result.conflict,
          serverHlc,
          ...(result.reason ? { reason: result.reason } : {}),
        };
      } catch (error) {
        ack = {
          mutationId: mutation.mutationId,
          accepted: false,
          entityId: mutation.entityId,
          serverVersion: mutation.version,
          conflict: true,
          serverHlc,
          reason: error instanceof Error ? error.message.slice(0, 300) : 'Server apply failed',
        };
      }

      db.insert(appliedMutations)
        .values({
          mutationId: mutation.mutationId,
          academyId: context.academyId,
          deviceId: mutation.deviceId,
          entity: mutation.entity,
          entityId: ack.entityId,
          resultJson: ack as unknown as Record<string, unknown>,
        })
        .onConflictDoNothing()
        .run();
      acks.push(ack);
    }

    return { ok: true, data: { acks, serverHlc: serverClock.tick() } };
  });

  app.get('/v1/sync/pull', { preHandler: authenticate }, async (request) => {
    const context = auth(request);
    const query = syncPullQuerySchema.parse(request.query);
    const deviceId = String(request.headers['x-device-id'] ?? query.deviceId);
    if (context.tokenType === 'device' && context.deviceId && context.deviceId !== deviceId) {
      throw forbidden('Device token does not match X-Device-Id');
    }

    const since = query.since ?? GENESIS_HLC;
    const rows = db
      .select()
      .from(syncChanges)
      .where(
        and(
          eq(syncChanges.academyId, context.academyId),
          gt(syncChanges.hlc, since),
          ne(syncChanges.originDeviceId, deviceId),
        ),
      )
      .orderBy(asc(syncChanges.hlc))
      .limit(query.limit + 1)
      .all();

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const serverHlc = serverClock.tick();

    db.insert(syncCursors)
      .values({
        academyId: context.academyId,
        deviceId,
        lastServerHlc: serverHlc,
        lastPulledAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [syncCursors.academyId, syncCursors.deviceId],
        set: { lastServerHlc: serverHlc, lastPulledAt: new Date().toISOString() },
      })
      .run();

    return {
      ok: true,
      data: {
        changes: page.map((row) => ({
          entity: row.entity,
          entityId: row.entityId,
          operation: row.operation,
          payload: row.payload,
          hlc: row.hlc,
          version: row.version,
        })),
        serverHlc,
        hasMore,
      },
    };
  });
}
