import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, findWorkspaceRoot, promotions, resolveDatabaseUrl, users, type Db } from '@gymlytics/db';
import { buildApp } from '../app';

/** Separate DB copy from api.test.ts so the two suites cannot race. */
const workspaceRoot = findWorkspaceRoot();
const sourcePath = resolveDatabaseUrl().replace(/^file:/, '');
const testPath = join(workspaceRoot, 'data', 'api-saas-test.db');

if (sourcePath !== testPath && existsSync(sourcePath)) {
  mkdirSync(dirname(testPath), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(`${sourcePath}${suffix}`)) copyFileSync(`${sourcePath}${suffix}`, `${testPath}${suffix}`);
  }
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

interface Session {
  accessToken: string;
  user: { id: string; role: string };
  academy: { id: string; slug: string };
}

let app: Awaited<ReturnType<typeof buildApp>>;
let db: Db;
let session: Session;
let classId: string;

async function call<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  options: { token?: string; body?: unknown } = {},
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
  return {
    status: response.statusCode,
    body: JSON.parse(response.body) as Envelope<T>,
  };
}

async function login(email: string, academySlug: string): Promise<Session> {
  const response = await call<Session>('POST', '/v1/auth/login', {
    body: { email, password: 'Password123!', academySlug },
  });
  expect(response.status).toBe(200);
  return response.body.data!;
}

async function createStudent(prefix: string): Promise<string> {
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const response = await call<{ id: string }>('POST', '/v1/members', {
    token: session.accessToken,
    body: {
      firstName: prefix,
      lastName: 'Visitor',
      email: `${prefix.toLowerCase()}.${stamp}@gymlytics.test`,
      role: 'student',
      status: 'active',
    },
  });
  expect(response.status).toBe(201);
  return response.body.data!.id;
}

beforeAll(async () => {
  db = createDb(testPath);
  app = await buildApp(db);
  session = await login('owner@gymlytics.test', 'gymlytics-demo');
  const classes = await call<{ id: string }[]>('GET', '/v1/classes', { token: session.accessToken });
  classId = classes.body.data![0]!.id;
});

afterAll(async () => {
  await app.close();
});

describe('subscription tiers', () => {
  it('publishes three ordered plans', async () => {
    const response = await call<{ slug: string; features: string[] }[]>('GET', '/v1/saas/plans', {
      token: session.accessToken,
    });
    expect(response.status).toBe(200);
    expect(response.body.data?.map((plan) => plan.slug)).toEqual(['starter', 'growth', 'network']);
    expect(response.body.data?.every((plan) => plan.features.includes('members'))).toBe(true);
  });

  it('resolves the seeded academy to the Network plan', async () => {
    const response = await call<{ plan: { slug: string }; features: string[] }>(
      'GET', '/v1/saas/subscription', { token: session.accessToken },
    );
    expect(response.status).toBe(200);
    expect(response.body.data?.plan.slug).toBe('network');
    expect(response.body.data?.features).toContain('multi_site');
  });

  it('fails closed when a downgraded plan calls a gated module', async () => {
    try {
      const downgrade = await call('POST', '/v1/saas/subscription/change', {
        token: session.accessToken,
        body: { planSlug: 'starter' },
      });
      expect(downgrade.status).toBe(200);

      const widgets = await call('POST', '/v1/widgets', {
        token: session.accessToken,
        body: { kind: 'schedule', label: 'Blocked widget' },
      });
      expect(widgets.status).toBe(422);
      expect(widgets.body.error?.details).toMatchObject({ feature: 'widgets', upgradeRequired: true });

      const imports = await call('POST', '/v1/imports', {
        token: session.accessToken,
        body: { type: 'members', csv: 'firstName,lastName\nA,B\n' },
      });
      expect(imports.status).toBe(422);
      expect(imports.body.error?.details).toMatchObject({ feature: 'csv_import', upgradeRequired: true });
    } finally {
      const restore = await call('POST', '/v1/saas/subscription/change', {
        token: session.accessToken,
        body: { planSlug: 'network' },
      });
      expect(restore.status).toBe(200);
    }
  });
});

describe('guided onboarding', () => {
  it('completes the final step exactly once', async () => {
    const before = await call<{ progressPercent: number }>('GET', '/v1/saas/onboarding', {
      token: session.accessToken,
    });
    expect(before.body.data?.progressPercent).toBe(83);

    const done = await call<{ completedSteps: string[]; completedAt: string | null; progressPercent: number }>(
      'POST', '/v1/saas/onboarding/steps', { token: session.accessToken, body: { step: 'team' } },
    );
    expect(done.status).toBe(200);
    expect(done.body.data?.progressPercent).toBe(100);
    expect(done.body.data?.completedAt).toBeTruthy();

    const repeat = await call<{ completedSteps: string[] }>('POST', '/v1/saas/onboarding/steps', {
      token: session.accessToken,
      body: { step: 'team' },
    });
    expect(new Set(repeat.body.data?.completedSteps).size).toBe(repeat.body.data?.completedSteps.length);
    expect(repeat.body.data?.completedSteps).toHaveLength(6);
  });
});

describe('network rollups', () => {
  it('aggregates root and branch without leaking rosters to branch admins', async () => {
    const root = await call<{ locationCount: number; locations: { id: string; slug: string }[] }>(
      'GET', '/v1/network/overview', { token: session.accessToken },
    );
    expect(root.status).toBe(200);
    expect(root.body.data?.locationCount).toBe(2);
    expect(root.body.data?.locations.map((row) => row.slug)).toContain('gymlytics-demo-pj');

    const branchAdmin = await login('branch-admin@gymlytics.test', 'gymlytics-demo-pj');
    const branch = await call<{ locationCount: number; locations: { id: string }[] }>(
      'GET', '/v1/network/overview', { token: branchAdmin.accessToken },
    );
    expect(branch.status).toBe(200);
    expect(branch.body.data?.locationCount).toBe(1);
    expect(branch.body.data?.locations[0]?.id).toBe(branchAdmin.academy.id);
  });

  it('rejects a student rollup request', async () => {
    const student = await login('daniel@student.test', 'gymlytics-demo');
    const response = await call('GET', '/v1/network/overview', { token: student.accessToken });
    expect(response.status).toBe(403);
  });
});

describe('CSV migration', () => {
  it('imports members, reports bad rows and stays idempotent by email', async () => {
    const stamp = randomUUID().slice(0, 8);
    const emailA = `csv-a.${stamp}@gymlytics.test`;
    const emailB = `csv-b.${stamp}@gymlytics.test`;
    const csv = [
      'firstName,lastName,email,belt,stripes',
      `Asha,Import,${emailA},white,1`,
      `Bala,Import,${emailB},blue,0`,
      'Broken,Row,broken@example.test,white,9',
    ].join('\n');
    const body = { type: 'members', fileName: 'roster.csv', csv };

    const first = await call<{ importedRows: number; skippedRows: number; errors: { row: number }[] }>(
      'POST', '/v1/imports', { token: session.accessToken, body },
    );
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ importedRows: 2, skippedRows: 1 });
    expect(first.body.data?.errors[0]?.row).toBe(4);

    const again = await call<{ importedRows: number }>('POST', '/v1/imports', {
      token: session.accessToken, body,
    });
    expect(again.body.data?.importedRows).toBe(2);
    for (const email of [emailA, emailB]) {
      const rows = db.select({ id: users.id }).from(users).where(eq(users.email, email)).all();
      expect(rows).toHaveLength(1);
    }

    const history = await call<{ fileName: string }[]>('GET', '/v1/imports', {
      token: session.accessToken,
    });
    expect(history.body.data?.some((job) => job.fileName === 'roster.csv')).toBe(true);

    const ranks = await call<{ importedRows: number }>('POST', '/v1/imports', {
      token: session.accessToken,
      body: { type: 'belt_ranks', csv: `email,belt,stripes,promotedAt\n${emailA},blue,2,2026-01-15\n` },
    });
    expect(ranks.body.data?.importedRows).toBe(1);
    const member = db.select({ id: users.id }).from(users).where(eq(users.email, emailA)).get()!;
    const awarded = db.select().from(promotions)
      .where(and(eq(promotions.userId, member.id), eq(promotions.toStripes, 2))).all();
    expect(awarded).toHaveLength(1);
  });

  it('serves a CSV template', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/imports/template/belt_ranks',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('email,belt,stripes');
  });
});

describe('embeddable widgets', () => {
  interface Widget { id: string; kind: string; token: string; enabled: boolean; embedCode: string }

  it('serves a public schedule without a session', async () => {
    const list = await call<Widget[]>('GET', '/v1/widgets', { token: session.accessToken });
    expect(list.status).toBe(200);
    const schedule = list.body.data!.find((widget) => widget.kind === 'schedule')!;
    expect(schedule.embedCode).toContain(`/embed/schedule/${schedule.token}`);

    const publicSchedule = await call<{ academyName: string; classes: unknown[] }>(
      'GET', `/v1/widgets/public/${schedule.token}/schedule`,
    );
    expect(publicSchedule.status).toBe(200);
    expect(publicSchedule.body.data?.academyName).toBeTruthy();
    expect(Array.isArray(publicSchedule.body.data?.classes)).toBe(true);
  });

  it('turns a trial form submission into a lead and honours disable', async () => {
    const created = await call<Widget>('POST', '/v1/widgets', {
      token: session.accessToken,
      body: { kind: 'trial_form', label: 'Website trial', config: { redirectUrl: '/thanks' } },
    });
    expect(created.status).toBe(201);
    const widget = created.body.data!;

    const submission = await call<{ redirectUrl: string }>(
      'POST', `/v1/widgets/public/${widget.token}/trials`,
      { body: { firstName: 'Public', lastName: 'Visitor', email: 'public@example.test' } },
    );
    expect(submission.status).toBe(201);
    expect(submission.body.data?.redirectUrl).toBe('/thanks');

    const disabled = await call('PATCH', `/v1/widgets/${widget.id}`, {
      token: session.accessToken, body: { enabled: false },
    });
    expect(disabled.status).toBe(200);
    const blocked = await call('POST', `/v1/widgets/public/${widget.token}/trials`, {
      body: { firstName: 'Blocked', lastName: 'Visitor' },
    });
    expect(blocked.status).toBe(404);

    await call('DELETE', `/v1/widgets/${widget.id}`, { token: session.accessToken });
  });
});

describe('cross-training passes', () => {
  interface Affiliation { id: string; verifiedAt: string | null }
  interface Pass { id: string; qrToken: string; status: string; waiverId: string | null }
  interface Template { version: number; documentHash: string }

  it('blocks check-in until a waiver is signed, then applies it idempotently', async () => {
    const affiliationList = await call<Affiliation[]>('GET', '/v1/affiliations', {
      token: session.accessToken,
    });
    const affiliation = affiliationList.body.data!.find((row) => row.verifiedAt)!;
    const visitorId = await createStudent('Visiting');

    const created = await call<Pass>('POST', '/v1/passes', {
      token: session.accessToken,
      body: {
        visitorId,
        affiliationId: affiliation.id,
        passDate: new Date().toISOString().slice(0, 10),
      },
    });
    expect(created.status).toBe(201);
    const pass = created.body.data!;

    const publicPass = await call<{ waiverRequired: boolean; visitorName: string }>(
      'GET', `/v1/passes/public/${pass.qrToken}`,
    );
    expect(publicPass.body.data?.waiverRequired).toBe(true);
    expect(publicPass.body.data?.visitorName).toContain('Visiting');

    const mutationId = randomUUID();
    const payload = {
      classId,
      mutationId,
      hlc: `${new Date().toISOString()}-0000-saas-test`,
      deviceId: 'saas-test',
      checkedInAt: new Date().toISOString(),
    };
    const blocked = await call('POST', `/v1/passes/${pass.id}/check-in`, {
      token: session.accessToken, body: payload,
    });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error?.message).toContain('waiver');

    const templates = await call<Template[]>('GET', '/v1/waivers/templates?type=dropin', {
      token: session.accessToken,
    });
    const template = templates.body.data![0]!;
    const signed = await call('POST', '/v1/waivers', {
      token: session.accessToken,
      body: {
        academyId: session.academy.id,
        userId: visitorId,
        waiverType: 'dropin',
        documentVersion: template.version,
        documentHash: template.documentHash,
        signatureData: 'M 10 10 L 200 40 L 320 20',
        signatureFormat: 'svg_path',
        signerName: 'Visiting Visitor',
        signedAt: new Date().toISOString(),
        mutationId: randomUUID(),
        hlc: `${new Date().toISOString()}-0000-saas-test`,
      },
    });
    expect([200, 201]).toContain(signed.status);

    const checkedIn = await call<{ attendanceId: string; warnings: string[] }>(
      'POST', `/v1/passes/${pass.id}/check-in`, { token: session.accessToken, body: payload },
    );
    expect(checkedIn.status).toBe(200);
    expect(checkedIn.body.data?.warnings).toContain('Cross-training visitor');

    const replay = await call<{ attendanceId: string }>('POST', `/v1/passes/${pass.id}/check-in`, {
      token: session.accessToken, body: payload,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.data?.attendanceId).toBe(checkedIn.body.data?.attendanceId);

    const reused = await call('POST', `/v1/passes/${pass.id}/check-in`, {
      token: session.accessToken, body: { ...payload, mutationId: randomUUID() },
    });
    expect(reused.status).toBe(409);
  });
});

describe('curriculum and family portal', () => {
  interface Video { id: string; beltSlug: string | null; title: string }
  interface Dependent { id: string; relationship: string }

  it('serves belt-scoped videos and class recaps', async () => {
    const videos = await call<Video[]>('GET', '/v1/curriculum/videos', {
      token: session.accessToken,
    });
    expect(videos.status).toBe(200);
    expect(videos.body.data!.length).toBeGreaterThanOrEqual(3);
    expect(videos.body.data!.every((video) => video.beltSlug === 'blue')).toBe(true);

    const saved = await call('PUT', `/v1/classes/${classId}/recap`, {
      token: session.accessToken,
      body: {
        summary: 'Drilled the hip-bump escape, then finished with positional sparring from mount.',
        techniques: ['Hip bump escape', 'Bridge and roll'],
      },
    });
    expect([200, 201]).toContain(saved.status);

    const recap = await call<{ summary: string; techniques: string[] }>(
      'GET', `/v1/classes/${classId}/recap`, { token: session.accessToken },
    );
    expect(recap.status).toBe(200);
    expect(recap.body.data?.summary).toContain('hip-bump');
    expect(recap.body.data?.techniques).toContain('Bridge and roll');

    const created = await call<Video>('POST', '/v1/curriculum/videos', {
      token: session.accessToken,
      body: {
        title: 'Test guard retention',
        url: 'https://example.test/video',
        beltSlug: 'white',
        durationSeconds: 120,
      },
    });
    expect(created.status).toBe(201);
    const deleted = await call('DELETE', `/v1/curriculum/videos/${created.body.data!.id}`, {
      token: session.accessToken,
    });
    expect(deleted.status).toBe(200);
  });

  it('scopes a guardian to their own children', async () => {
    const guardian = await login('parent@gymlytics.test', 'gymlytics-demo');
    const dependents = await call<Dependent[]>('GET', '/v1/family/dependents', {
      token: guardian.accessToken,
    });
    expect(dependents.status).toBe(200);
    expect(dependents.body.data!.length).toBeGreaterThan(0);

    const childId = dependents.body.data![0]!.id;
    const schedule = await call<unknown[]>('GET', `/v1/family/dependents/${childId}/schedule`, {
      token: guardian.accessToken,
    });
    const progression = await call<{ history: unknown[]; eligibility: unknown[] }>(
      'GET', `/v1/family/dependents/${childId}/progression`, { token: guardian.accessToken },
    );
    expect(schedule.status).toBe(200);
    expect(progression.status).toBe(200);
    expect(Array.isArray(progression.body.data?.history)).toBe(true);

    const stranger = await createStudent('Unrelated');
    const denied = await call('GET', `/v1/family/dependents/${stranger}/schedule`, {
      token: guardian.accessToken,
    });
    expect(denied.status).toBe(403);
  });
});
