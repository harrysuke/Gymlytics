import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, findWorkspaceRoot, resolveDatabaseUrl, type Db } from '@gymlytics/db';
import { buildApp } from '../app';

/**
 * Runs against a throwaway copy of the seeded database so the suite never
 * mutates the developer's working data and stays repeatable.
 */
const workspaceRoot = findWorkspaceRoot();
const sourcePath = resolveDatabaseUrl().replace(/^file:/, '');
const testPath = join(workspaceRoot, 'data', 'api-test.db');

let app: Awaited<ReturnType<typeof buildApp>>;
let db: Db;

if (sourcePath !== testPath && existsSync(sourcePath)) {
  mkdirSync(dirname(testPath), { recursive: true });
  // Copy the WAL sidecars too, otherwise committed-but-uncheckpointed rows vanish.
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(`${sourcePath}${suffix}`)) copyFileSync(`${sourcePath}${suffix}`, `${testPath}${suffix}`);
  }
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: { userId?: string } };
}

interface CallOptions {
  token?: string;
  body?: unknown;
}

async function call<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  options: CallOptions = {},
): Promise<{ status: number; body: Envelope<T> }> {
  const response = await app.inject({
    method,
    url,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }),
  });
  let parsed: Envelope<T>;
  try {
    parsed = JSON.parse(response.body) as Envelope<T>;
  } catch {
    parsed = { ok: false, error: { code: 'non_json', message: response.body.slice(0, 200) } };
  }
  return { status: response.statusCode, body: parsed };
}

interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; role: string; email: string };
  academy: { id: string; slug: string };
}

let session: Session;
let academyId: string;
let classId: string;
let productId: string;
let memberSeq = 0;

function hlc(): string {
  return `${new Date().toISOString()}-0000-api-test`;
}

async function createMember(firstName: string): Promise<string> {
  memberSeq += 1;
  const stamp = `${Date.now()}-${memberSeq}`;
  const created = await call<{ id: string }>('POST', '/v1/members', {
    token: session.accessToken,
    body: {
      firstName,
      lastName: 'Testcase',
      email: `${firstName.toLowerCase()}.${stamp}@gymlytics.test`,
      role: 'student',
      status: 'active',
    },
  });
  expect(created.status).toBe(201);
  return created.body.data!.id;
}

beforeAll(async () => {
  db = createDb(testPath);
  app = await buildApp(db);

  const login = await call<Session>('POST', '/v1/auth/login', {
    body: { email: 'owner@gymlytics.test', password: 'Password123!', academySlug: 'gymlytics-demo' },
  });
  expect(login.status).toBe(200);
  session = login.body.data!;
  academyId = session.academy.id;

  const classes = await call<{ id: string }[]>('GET', '/v1/classes', { token: session.accessToken });
  classId = classes.body.data![0]!.id;

  const products = await call<{ id: string }[]>('GET', '/v1/billing/products', {
    token: session.accessToken,
  });
  productId = products.body.data![0]!.id;
});

afterAll(async () => {
  await app.close();
});

describe('health', () => {
  it('reports liveness', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ service: 'gymlytics-api' });
  });

  it('reports readiness', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ ready: true });
  });
});

describe('authentication', () => {
  it('issues a session for valid credentials', () => {
    expect(session.accessToken).toBeTruthy();
    expect(session.user.role).toBe('owner');
    expect(session.academy.slug).toBe('gymlytics-demo');
  });

  it('rejects a wrong password', async () => {
    const response = await call('POST', '/v1/auth/login', {
      body: { email: 'owner@gymlytics.test', password: 'not-the-password', academySlug: 'gymlytics-demo' },
    });
    expect(response.status).toBe(401);
  });

  it('rejects an unknown email without leaking that the account is missing', async () => {
    const response = await call('POST', '/v1/auth/login', {
      body: { email: 'nobody@gymlytics.test', password: 'Password123!', academySlug: 'gymlytics-demo' },
    });
    expect(response.status).toBe(401);
    expect(response.body.error?.message).not.toMatch(/no such|not found|unknown user/i);
  });

  it('denies a protected route without a token', async () => {
    const response = await call('GET', '/v1/members');
    expect(response.status).toBe(401);
  });

  it('denies a protected route with a forged token', async () => {
    const response = await call('GET', '/v1/members', { token: 'not.a.jwt' });
    expect(response.status).toBe(401);
  });

  it('accepts the access token on a protected route', async () => {
    const response = await call<unknown[]>('GET', '/v1/members', { token: session.accessToken });
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('returns the caller identity', async () => {
    const response = await call<{ user: { email: string } }>('GET', '/v1/auth/me', {
      token: session.accessToken,
    });
    expect(response.status).toBe(200);
    expect(response.body.data?.user.email).toBe('owner@gymlytics.test');
  });

  it('rotates the refresh token and revokes the old one', async () => {
    const fresh = await call<Session>('POST', '/v1/auth/login', {
      body: { email: 'owner@gymlytics.test', password: 'Password123!', academySlug: 'gymlytics-demo' },
    });
    const original = fresh.body.data!.refreshToken;

    const rotated = await call<Session>('POST', '/v1/auth/refresh', { body: { refreshToken: original } });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data?.accessToken).toBeTruthy();
    expect(rotated.body.data?.refreshToken).not.toBe(original);

    const replay = await call('POST', '/v1/auth/refresh', { body: { refreshToken: original } });
    expect(replay.status).toBe(401);
  });
});

describe('check-in waiver gate', () => {
  it('blocks a member with no signed waiver from reaching the mat', async () => {
    const memberId = await createMember('Waivergate');
    const response = await call<{ userId: string }>('POST', '/v1/check-in', {
      token: session.accessToken,
      body: {
        academyId,
        classId,
        mutationId: crypto.randomUUID(),
        hlc: hlc(),
        deviceId: 'api-test-kiosk',
        checkedInAt: new Date().toISOString(),
        method: 'name_search',
        userId: memberId,
        staffConfirmation: true,
      },
    });

    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe('waiver_required');
    expect(response.body.error?.details?.userId).toBe(memberId);
  });

  it('lets staff override with an auditable reason', async () => {
    const memberId = await createMember('Override');
    const response = await call<{ attendanceId: string; status: string }>('POST', '/v1/check-in', {
      token: session.accessToken,
      body: {
        academyId,
        classId,
        mutationId: crypto.randomUUID(),
        hlc: hlc(),
        deviceId: 'api-test-kiosk',
        checkedInAt: new Date().toISOString(),
        method: 'admin',
        userId: memberId,
        overrideReason: 'Waiver signed on paper, filing pending',
      },
    });

    expect(response.status).toBe(201);
    expect(response.body.data?.status).toBe('checked_in');
  });

  it('replays a check-in for the same mutation id without duplicating it', async () => {
    const memberId = await createMember('Replay');
    const mutationId = crypto.randomUUID();
    const body = {
      academyId,
      classId,
      mutationId,
      hlc: hlc(),
      deviceId: 'api-test-kiosk',
      checkedInAt: new Date().toISOString(),
      method: 'admin' as const,
      userId: memberId,
      overrideReason: 'Offline kiosk replay',
    };

    const first = await call<{ attendanceId: string }>('POST', '/v1/check-in', {
      token: session.accessToken,
      body,
    });
    const second = await call<{ attendanceId: string }>('POST', '/v1/check-in', {
      token: session.accessToken,
      body,
    });

    // The first call creates (201); the replay is served from the idempotency
    // ledger and is not a new resource (200), but must be the same row.
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data?.attendanceId).toBe(first.body.data?.attendanceId);
  });

  it('rejects a check-in aimed at another academy', async () => {
    const response = await call('POST', '/v1/check-in', {
      token: session.accessToken,
      body: {
        academyId: crypto.randomUUID(),
        classId,
        mutationId: crypto.randomUUID(),
        hlc: hlc(),
        deviceId: 'api-test-kiosk',
        checkedInAt: new Date().toISOString(),
        method: 'admin',
        userId: session.user.id,
        overrideReason: 'Cross tenant probe',
      },
    });
    expect(response.status).toBe(403);
  });
});

describe('offline sync push', () => {
  function mutation(entityId: string) {
    return {
      mutationId: crypto.randomUUID(),
      academyId,
      deviceId: 'api-test-kiosk',
      entity: 'attendance_log' as const,
      entityId,
      operation: 'insert' as const,
      payload: { classId, userId: session.user.id, checkedInAt: new Date().toISOString(), method: 'pin' },
      hlc: hlc(),
      version: 1,
    };
  }

  it('acknowledges an applied mutation', async () => {
    const body = mutation(crypto.randomUUID());
    const response = await call<{ acks: { mutationId: string; accepted: boolean }[] }>(
      'POST',
      '/v1/sync/push',
      { token: session.accessToken, body: { mutations: [body] } },
    );

    expect(response.status).toBe(200);
    expect(response.body.data?.acks[0]).toMatchObject({ mutationId: body.mutationId });
  });

  it('replays an already-applied mutation from the idempotency ledger', async () => {
    const body = mutation(crypto.randomUUID());
    const first = await call<{ acks: Record<string, unknown>[] }>('POST', '/v1/sync/push', {
      token: session.accessToken,
      body: { mutations: [body] },
    });
    const second = await call<{ acks: Record<string, unknown>[] }>('POST', '/v1/sync/push', {
      token: session.accessToken,
      body: { mutations: [body] },
    });

    expect(second.status).toBe(200);
    expect(second.body.data?.acks[0]).toEqual(first.body.data?.acks[0]);
  });

  it('refuses a mutation tagged for a different academy', async () => {
    const body = { ...mutation(crypto.randomUUID()), academyId: crypto.randomUUID() };
    const response = await call<{ acks: { conflict: boolean; reason?: string }[] }>(
      'POST',
      '/v1/sync/push',
      { token: session.accessToken, body: { mutations: [body] } },
    );

    expect(response.status).toBe(200);
    expect(response.body.data?.acks[0]?.conflict).toBe(true);
    expect(response.body.data?.acks[0]?.reason).toMatch(/cross-academy/i);
  });

  it('serves a delta feed from a cursor', async () => {
    const response = await call<{ changes: unknown[]; hasMore: boolean }>(
      'GET',
      '/v1/sync/pull?deviceId=api-test-kiosk',
      { token: session.accessToken },
    );
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data?.changes)).toBe(true);
    expect(typeof response.body.data?.hasMore).toBe('boolean');
  });
});

describe('POS idempotency', () => {
  function sale(idempotencyKey: string) {
    return {
      academyId,
      lineItems: [{ productId, quantity: 1 }],
      provider: 'manual' as const,
      discountCents: 0,
      idempotencyKey,
    };
  }

  it('records a manual sale', async () => {
    const response = await call<{ id: string; duplicate?: boolean }>('POST', '/v1/billing/pos', {
      token: session.accessToken,
      body: sale(crypto.randomUUID()),
    });
    expect(response.status).toBe(201);
    expect(response.body.data?.id).toBeTruthy();
  });

  it('returns the original transaction when the same key is submitted twice', async () => {
    const key = crypto.randomUUID();
    const first = await call<{ id: string }>('POST', '/v1/billing/pos', {
      token: session.accessToken,
      body: sale(key),
    });
    const second = await call<{ id: string; duplicate: boolean }>('POST', '/v1/billing/pos', {
      token: session.accessToken,
      body: sale(key),
    });

    expect(second.body.data?.id).toBe(first.body.data?.id);
    expect(second.body.data?.duplicate).toBe(true);
  });

  it('rejects an unknown product', async () => {
    const response = await call('POST', '/v1/billing/pos', {
      token: session.accessToken,
      body: {
        academyId,
        lineItems: [{ productId: crypto.randomUUID(), quantity: 1 }],
        provider: 'manual',
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(response.status).toBe(404);
  });

  it('rejects an empty cart', async () => {
    const response = await call('POST', '/v1/billing/pos', {
      token: session.accessToken,
      body: { academyId, lineItems: [], provider: 'manual', idempotencyKey: crypto.randomUUID() },
    });
    expect(response.status).toBe(400);
  });
});

describe('role enforcement', () => {
  it('denies a student access to the member roster', async () => {
    const student = await call<Session>('POST', '/v1/auth/login', {
      body: { email: 'daniel@student.test', password: 'Password123!', academySlug: 'gymlytics-demo' },
    });
    expect(student.status).toBe(200);

    const response = await call('GET', '/v1/members', { token: student.body.data!.accessToken });
    expect(response.status).toBe(403);
  });
});

describe('analytics', () => {
  const endpoints = [
    '/v1/analytics/overview',
    '/v1/analytics/progression',
    '/v1/analytics/attendance',
    '/v1/analytics/retention',
    '/v1/analytics/financial',
    '/v1/analytics/leads',
  ];

  for (const endpoint of endpoints) {
    it(`returns metrics from ${endpoint}`, async () => {
      const response = await call<{ metrics: Array<{ label: string; value: string }> }>('GET', endpoint, {
        token: session.accessToken,
      });
      expect(response.status).toBe(200);
      expect(response.body.data!.metrics.length).toBeGreaterThan(0);
      expect(response.body.data!.metrics[0]!.value).toBeTruthy();
    });
  }

  it('denies coaches access to financial analytics', async () => {
    const coach = await call<Session>('POST', '/v1/auth/login', {
      body: { email: 'coach@gymlytics.test', password: 'Password123!', academySlug: 'gymlytics-demo' },
    });
    const response = await call('GET', '/v1/analytics/financial', {
      token: coach.body.data!.accessToken,
    });
    expect(response.status).toBe(403);
  });

  it('gives students their own analytics but not other members', async () => {
    const student = await call<Session>('POST', '/v1/auth/login', {
      body: { email: 'daniel@student.test', password: 'Password123!', academySlug: 'gymlytics-demo' },
    });
    const own = await call<{ userId: string }>('GET', '/v1/analytics/me', {
      token: student.body.data!.accessToken,
    });
    expect(own.status).toBe(200);
    expect(own.body.data!.userId).toBe(student.body.data!.user.id);
    const other = await call('GET', `/v1/analytics/member/${academyId}`, {
      token: student.body.data!.accessToken,
    });
    expect(other.status).toBe(403);
  });

  it('returns a member drilldown for staff', async () => {
    const response = await call<{ memberName: string; progression: unknown[] }>(
      'GET',
      `/v1/analytics/member/${session.user.id}`,
      { token: session.accessToken },
    );
    expect(response.status).toBe(200);
    expect(response.body.data!.memberName).toBeTruthy();
    expect(Array.isArray(response.body.data!.progression)).toBe(true);
  });
});

describe('reports', () => {
  const slugs = [
    'belt-eligibility',
    'daily-roster',
    'instructor-payroll',
    'mia-at-risk',
    'membership-changes',
    'trial-follow-up',
    'failed-payments',
    'revenue-tax',
    'proshop-inventory',
    'waiver-audit',
    'incident-log',
  ];

  it('lists the full report catalog', async () => {
    const response = await call<Array<{ slug: string }>>('GET', '/v1/reports', {
      token: session.accessToken,
    });
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(slugs.length);
  });

  for (const slug of slugs) {
    it(`builds ${slug}`, async () => {
      const response = await call<{
        rows: unknown[];
        summary: unknown[];
        columns: unknown[];
      }>('GET', `/v1/reports/${slug}`, { token: session.accessToken });
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.data!.rows)).toBe(true);
      expect(response.body.data!.summary.length).toBeGreaterThan(0);
      expect(response.body.data!.columns.length).toBeGreaterThan(0);
    });
  }

  it('rejects an unknown report', async () => {
    const response = await call('GET', '/v1/reports/not-a-report', { token: session.accessToken });
    expect(response.status).toBe(400);
  });

  it('captures a lead and reflects it in the follow-up report', async () => {
    const created = await call<{ id: string }>('POST', '/v1/leads', {
      token: session.accessToken,
      body: {
        firstName: 'Report',
        lastName: `Lead${Date.now()}`,
        email: `report.lead.${Date.now()}@test.local`,
        source: 'social_media',
        trialAttendedAt: new Date().toISOString(),
      },
    });
    expect(created.status).toBe(201);
    const updated = await call('PATCH', `/v1/leads/${created.body.data!.id}`, {
      token: session.accessToken,
      body: { status: 'contacted' },
    });
    expect(updated.status).toBe(200);
    const report = await call<{ rows: Array<{ lead: string }> }>('GET', '/v1/reports/trial-follow-up', {
      token: session.accessToken,
    });
    expect(report.body.data!.rows.some((row) => row.lead.startsWith('Report Lead'))).toBe(true);
  });

  it('captures an incident and lists it in the log', async () => {
    const created = await call<{ id: string }>('POST', '/v1/incidents', {
      token: session.accessToken,
      body: {
        occurredAt: new Date().toISOString(),
        type: 'near_miss',
        severity: 'minor',
        description: 'Test incident created by the API suite',
        followUpRequired: true,
      },
    });
    expect(created.status).toBe(201);
    const report = await call<{ rows: Array<{ description: string }> }>('GET', '/v1/reports/incident-log', {
      token: session.accessToken,
    });
    expect(
      report.body.data!.rows.some((row) => row.description === 'Test incident created by the API suite'),
    ).toBe(true);
  });
});
