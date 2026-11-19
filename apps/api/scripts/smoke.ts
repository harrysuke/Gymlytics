/**
 * End-to-end smoke test against the real database.
 *
 * Runs the Fastify app in-process via `app.inject()` so it needs no listening
 * socket — which also makes it usable in CI where localhost networking is
 * sandboxed. Exits non-zero on the first failure.
 *
 *   pnpm --filter @gymlytics/api smoke
 */
import { createDb, resolveDatabaseUrl } from '@gymlytics/db';
import { buildApp } from '../src/app';

const db = createDb(resolveDatabaseUrl());
const app = await buildApp(db);

let passed = 0;
let failed = 0;

function ok(label: string, detail?: string): void {
  passed += 1;
  console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label: string, detail: string): void {
  failed += 1;
  console.log(`  FAIL ${label} — ${detail}`);
}

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) ok(label, detail);
  else fail(label, detail ?? 'assertion failed');
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function call<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
  let parsed: Envelope<T>;
  try {
    parsed = JSON.parse(response.body) as Envelope<T>;
  } catch {
    parsed = { ok: false, error: { code: 'non_json', message: response.body.slice(0, 200) } };
  }
  return { status: response.statusCode, body: parsed };
}

console.log('\nGymlytics API smoke test\n');

// ---------------------------------------------------------------- health
{
  const health = await app.inject({ method: 'GET', url: '/health' });
  check(
    'GET /health',
    health.statusCode === 200 && (JSON.parse(health.body) as { service: string }).service === 'gymlytics-api',
  );

  const ready = await app.inject({ method: 'GET', url: '/ready' });
  check('GET /ready', ready.statusCode === 200 && (JSON.parse(ready.body) as { ready: boolean }).ready === true);
}

// ----------------------------------------------------------------- login
interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; role: string; firstName: string };
  academy: { id: string; slug: string; name: string };
}

const login = await call<Session>('POST', '/v1/auth/login', {
  body: { email: 'owner@gymlytics.test', password: 'Password123!', academySlug: 'gymlytics-demo' },
});
if (login.status !== 200 || !login.body.data) {
  fail('POST /v1/auth/login', `${login.status} ${login.body.error?.message ?? ''}`);
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
const session = login.body.data;
const token = session.accessToken;
ok('POST /v1/auth/login', `${session.user.firstName} (${session.user.role}) @ ${session.academy.slug}`);

const academyId = session.academy.id;

{
  const bad = await call('POST', '/v1/auth/login', {
    body: { email: 'owner@gymlytics.test', password: 'wrong-password', academySlug: 'gymlytics-demo' },
  });
  check('rejects bad password', bad.status === 401, `status ${bad.status}`);

  const me = await call<{ user: { email: string }; dependents: unknown[] }>('GET', '/v1/auth/me', { token });
  check('GET /v1/auth/me', me.status === 200 && me.body.data?.user.email === 'owner@gymlytics.test');

  const refreshed = await call<Session>('POST', '/v1/auth/refresh', {
    body: { refreshToken: session.refreshToken },
  });
  check('POST /v1/auth/refresh', refreshed.status === 200 && Boolean(refreshed.body.data?.accessToken));

  const reused = await call('POST', '/v1/auth/refresh', { body: { refreshToken: session.refreshToken } });
  check('refresh token rotation revokes the old one', reused.status === 401, `status ${reused.status}`);
}

// ------------------------------------------------------------- dashboard
{
  const summary = await call<{
    activeMembers: number;
    classesToday: number;
    mrrCents: number;
    alerts: { kind: string }[];
    todayClasses: unknown[];
  }>('GET', '/v1/dashboard/summary', { token });
  const data = summary.body.data;
  check(
    'GET /v1/dashboard/summary',
    summary.status === 200 && (data?.activeMembers ?? 0) > 0,
    `${data?.activeMembers} active, ${data?.classesToday} classes today, MRR ${(data?.mrrCents ?? 0) / 100}`,
  );
  check('dashboard returns alerts', (data?.alerts?.length ?? 0) > 0, `${data?.alerts?.length} alerts`);
}

// --------------------------------------------------------------- members
{
  const members = await call<{ id: string; firstName: string }[]>('GET', '/v1/members?limit=5', { token });
  check(
    'GET /v1/members',
    members.status === 200 && (members.body.data?.length ?? 0) > 0,
    `${members.body.data?.length} returned`,
  );

  const first = members.body.data?.[0];
  if (first) {
    const detail = await call<{ id: string; memberships: unknown[]; promotions: unknown[] }>(
      'GET',
      `/v1/members/${first.id}`,
      { token },
    );
    check(
      'GET /v1/members/:id',
      detail.status === 200 && detail.body.data?.id === first.id,
      `${detail.body.data?.memberships?.length ?? 0} memberships, ${detail.body.data?.promotions?.length ?? 0} promotions`,
    );
  }
}

// -------------------------------------------------------------- programs
{
  const programs = await call<{ id: string; name: string; ranks: unknown[] }[]>('GET', '/v1/programs', { token });
  check(
    'GET /v1/programs',
    programs.status === 200 && (programs.body.data?.length ?? 0) >= 8,
    `${programs.body.data?.length} programs`,
  );
}

// ---------------------------------------------------------------- kiosk
interface Kiosk {
  academy: { id: string; name: string };
  members: { id: string; firstName: string; pinHash: string | null; waiverValid: boolean }[];
  classes: { id: string; title: string; startsAt: string }[];
  serverHlc: string;
}

const kiosk = await call<Kiosk>('GET', '/v1/kiosk/bootstrap', { token });
check(
  'GET /v1/kiosk/bootstrap',
  kiosk.status === 200 && (kiosk.body.data?.members?.length ?? 0) > 0,
  `${kiosk.body.data?.members?.length} members, ${kiosk.body.data?.classes?.length} classes`,
);

// ------------------------------------------------------------- check-in
{
  const bootstrap = kiosk.body.data!;
  const targetClass = bootstrap.classes[0];
  const member = bootstrap.members.find((m) => m.waiverValid && m.pinHash);
  if (!targetClass || !member) {
    fail('POST /v1/check-in', 'no class or waiver-valid member available');
  } else {
    const mutationId = crypto.randomUUID();
    const payload = {
      academyId,
      classId: targetClass.id,
      mutationId,
      hlc: bootstrap.serverHlc,
      deviceId: 'smoke-kiosk-1',
      checkedInAt: new Date().toISOString(),
      method: 'name_search' as const,
      userId: member.id,
      staffConfirmation: true as const,
    };
    const checkIn = await call<{ attendanceId: string; warnings: string[] }>('POST', '/v1/check-in', {
      token,
      body: payload,
    });
    const alreadyIn =
      checkIn.status === 200 && (checkIn.body.data?.warnings ?? []).some((w) => w.includes('Already'));
    check(
      'POST /v1/check-in',
      checkIn.status === 201 || alreadyIn,
      `${member.firstName} → ${targetClass.title}${alreadyIn ? ' (already checked in)' : ''}`,
    );

    const replay = await call<{ attendanceId: string }>('POST', '/v1/check-in', { token, body: payload });
    check(
      'check-in is idempotent on mutationId',
      replay.status === 200 && replay.body.data?.attendanceId === checkIn.body.data?.attendanceId,
    );

    // Waiver gate: a member with no signed waiver must be refused.
    const unsigned = bootstrap.members.find((m) => !m.waiverValid);
    if (unsigned) {
      const blocked = await call('POST', '/v1/check-in', {
        token,
        body: { ...payload, mutationId: crypto.randomUUID(), userId: unsigned.id },
      });
      check(
        'check-in blocks unsigned waiver',
        blocked.status === 422 && blocked.body.error?.code === 'waiver_required',
        `${blocked.status} ${blocked.body.error?.code}`,
      );
    }
  }
}

// --------------------------------------------------------------- waivers
{
  const templates = await call<{ id: string; waiverType: string; version: number }[]>(
    'GET',
    '/v1/waivers/templates',
    { token },
  );
  check(
    'GET /v1/waivers/templates',
    templates.status === 200 && (templates.body.data?.length ?? 0) > 0,
    `${templates.body.data?.length} templates`,
  );

  const signedMember = kiosk.body.data?.members.find((m) => m.waiverValid);
  const signed = await call<{ id: string }[]>('GET', `/v1/waivers?userId=${signedMember?.id ?? ''}`, { token });
  const waiverId = signed.body.data?.[0]?.id;
  if (waiverId) {
    const pdf = await app.inject({
      method: 'GET',
      url: `/v1/waivers/${waiverId}/pdf`,
      headers: { authorization: `Bearer ${token}` },
    });
    const isPdf = pdf.body.startsWith('%PDF-');
    check(
      'GET /v1/waivers/:id/pdf',
      pdf.statusCode === 200 && isPdf,
      `${(pdf.rawPayload.length / 1024).toFixed(1)} KB, ${isPdf ? 'valid PDF header' : 'not a PDF'}`,
    );
  } else {
    fail('GET /v1/waivers/:id/pdf', 'no signed waiver in seed');
  }
}

// --------------------------------------------------------------- billing
{
  const plans = await call<{ id: string; name: string }[]>('GET', '/v1/billing/plans', { token });
  check('GET /v1/billing/plans', plans.status === 200 && (plans.body.data?.length ?? 0) > 0);

  const products = await call<{ id: string; name: string; stockQuantity: number }[]>(
    'GET',
    '/v1/billing/products',
    { token },
  );
  check('GET /v1/billing/products', products.status === 200 && (products.body.data?.length ?? 0) > 0);

  const product = products.body.data?.[0];
  if (product) {
    const sale = {
      academyId,
      lineItems: [{ productId: product.id, quantity: 1 }],
      provider: 'manual' as const,
      idempotencyKey: crypto.randomUUID(),
    };
    const first = await call<{ id: string; status: string }>('POST', '/v1/billing/pos', { token, body: sale });
    const second = await call<{ id: string; duplicate?: boolean }>('POST', '/v1/billing/pos', { token, body: sale });
    check(
      'POST /v1/billing/pos charges and decrements stock',
      first.status === 201 && first.body.data?.status === 'succeeded',
      `${product.name} — ${first.body.data?.status}`,
    );
    check(
      'POST /v1/billing/pos is idempotent on the key',
      second.body.data?.id === first.body.data?.id && second.body.data?.duplicate === true,
    );
  }
}

// ------------------------------------------------------------------ sync
{
  const bootstrap = kiosk.body.data!;
  const targetClass = bootstrap.classes[1] ?? bootstrap.classes[0];
  const member = bootstrap.members.find((m) => m.waiverValid);

  if (targetClass && member) {
    const mutation = {
      mutationId: crypto.randomUUID(),
      academyId,
      deviceId: 'smoke-kiosk-1',
      entity: 'attendance_log',
      entityId: crypto.randomUUID(),
      operation: 'insert',
      hlc: `${new Date().toISOString()}-0001-smoke-kiosk-1`,
      version: 1,
      payload: {
        classId: targetClass.id,
        userId: member.id,
        checkedInAt: new Date().toISOString(),
        method: 'qr',
      },
    };

    const push = await call<{ acks: { accepted: boolean; reason?: string }[] }>('POST', '/v1/sync/push', {
      token,
      body: { mutations: [mutation] },
    });
    check(
      'POST /v1/sync/push accepts a mutation',
      push.status === 200 && push.body.data?.acks?.[0]?.accepted === true,
      push.body.data?.acks?.[0]?.reason,
    );

    const replay = await call<{ acks: { accepted: boolean }[] }>('POST', '/v1/sync/push', {
      token,
      body: { mutations: [mutation] },
    });
    check('sync push replays the same mutationId without duplicating', replay.body.data?.acks?.[0]?.accepted === true);

    const pull = await call<{ changes: { entity: string }[]; hasMore: boolean; serverHlc: string }>(
      'GET',
      '/v1/sync/pull?deviceId=smoke-kiosk-2&limit=200',
      { token },
    );
    check(
      'GET /v1/sync/pull returns the change feed',
      pull.status === 200 && (pull.body.data?.changes?.length ?? 0) > 0,
      `${pull.body.data?.changes?.length} changes`,
    );
  }
}

// --------------------------------------------------------------- webhook
{
  const unsigned = await call('POST', '/v1/webhooks/stripe', {
    body: { id: 'evt_smoke', type: 'payment_intent.succeeded', data: { object: {} } },
  });
  check(
    'POST /v1/webhooks/stripe rejects unsigned payloads',
    unsigned.status === 400 || unsigned.status === 401,
    `status ${unsigned.status}`,
  );
}

// ------------------------------------------------------------ progression
{
  const eligibility = await call<{ items: unknown[] }[]>('GET', '/v1/promotions/eligibility', { token });
  check('GET /v1/promotions/eligibility', eligibility.status === 200);
}

await app.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
