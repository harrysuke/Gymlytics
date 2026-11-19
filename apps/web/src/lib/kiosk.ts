import type { KioskBootstrap, KioskClass, KioskMember } from '@gymlytics/shared';
import type { SqlExecutor } from '@gymlytics/sync';
import { api } from './api';

const SESSION_KEY = 'gymlytics.kiosk.session';

export interface KioskSession {
  token: string;
  deviceId: string;
  academyId: string;
  academyName: string;
  academySlug: string;
  currency: string;
  pairedAt: string;
}

export function loadSession(): KioskSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as KioskSession;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function saveSession(session: KioskSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/**
 * Pair the tablet with an academy using the deployment device key.
 * The resulting token is a long-lived *device* token — not a user session — so
 * a stolen tablet can be revoked without touching any staff password.
 */
export async function pairDevice(input: {
  academySlug: string;
  deviceId: string;
  deviceKey: string;
}): Promise<KioskSession> {
  const { data } = await api.post<{
    accessToken: string;
    deviceId: string;
    academy: { id: string; name: string; slug: string; currency: string };
  }>('/v1/auth/device', input, { anonymous: true });

  const session: KioskSession = {
    token: data.accessToken,
    deviceId: data.deviceId,
    academyId: data.academy.id,
    academyName: data.academy.name,
    academySlug: data.academy.slug,
    currency: data.academy.currency,
    pairedAt: new Date().toISOString(),
  };
  saveSession(session);
  return session;
}

export async function fetchBootstrap(session: KioskSession): Promise<KioskBootstrap> {
  const { data } = await api.get<KioskBootstrap>('/v1/kiosk/bootstrap', { token: session.token });
  return data;
}

/**
 * Persist the bootstrap into the kiosk's local SQLite so a shift survives a
 * dropped connection. Members and classes are replaced wholesale — the payload
 * is small (a few hundred rows) and partial merges would leave ghosts.
 */
export async function cacheBootstrap(sql: SqlExecutor, bootstrap: KioskBootstrap): Promise<void> {
  await sql.execute('BEGIN IMMEDIATE');
  try {
    await sql.execute('DELETE FROM users');
    for (const member of bootstrap.members) {
      await sql.execute(
        `INSERT INTO users
          (id, academy_id, role, status, first_name, last_name, pin_hash, qr_token,
           waiver_valid, waiver_expires_at, membership_status, membership_plan_type,
           classes_per_week, class_pack_count, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          member.id,
          bootstrap.academy.id,
          member.role,
          member.status,
          member.firstName,
          member.lastName,
          member.pinHash,
          member.qrToken,
          member.waiverValid ? 1 : 0,
          member.waiverExpiresAt,
          member.membershipStatus,
          member.membershipPlanType,
          member.classesPerWeek,
          member.classPackCount,
          bootstrap.generatedAt,
          bootstrap.generatedAt,
        ],
      );
    }

    await sql.execute('DELETE FROM classes');
    for (const item of bootstrap.classes) {
      await sql.execute(
        `INSERT INTO classes
          (id, academy_id, program_id, program_name, title, starts_at, ends_at, capacity, booked_count, location)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          item.id,
          bootstrap.academy.id,
          item.programId,
          item.programName,
          item.title,
          item.startsAt,
          item.endsAt,
          item.capacity,
          item.bookedCount,
          item.location,
        ],
      );
    }

    await sql.execute(
      `INSERT INTO local_sync_meta (key, value, updated_at) VALUES ('bootstrap', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [JSON.stringify(bootstrap.academy), bootstrap.generatedAt],
    );
    await sql.execute('COMMIT');
  } catch (error) {
    await sql.execute('ROLLBACK');
    throw error;
  }
}

export interface CachedBootstrap {
  academy: KioskBootstrap['academy'];
  members: KioskMember[];
  classes: KioskClass[];
  cachedAt: string;
}

/** Rebuild the bootstrap shape from SQLite when the network is unavailable. */
export async function readCachedBootstrap(sql: SqlExecutor): Promise<CachedBootstrap | null> {
  const meta = await sql.query<{ value: string; updated_at: string }>(
    "SELECT value, updated_at FROM local_sync_meta WHERE key = 'bootstrap' LIMIT 1",
  );
  if (!meta[0]) return null;

  const academy = JSON.parse(meta[0].value) as KioskBootstrap['academy'];

  const memberRows = await sql.query<{
    id: string;
    first_name: string;
    last_name: string;
    role: string;
    status: string;
    pin_hash: string | null;
    qr_token: string | null;
    waiver_valid: number;
    waiver_expires_at: string | null;
    membership_status: string | null;
    membership_plan_type: string | null;
    classes_per_week: number | null;
    class_pack_count: number | null;
  }>('SELECT * FROM users ORDER BY last_name, first_name');

  const classRows = await sql.query<{
    id: string;
    program_id: string;
    program_name: string;
    title: string;
    starts_at: string;
    ends_at: string;
    capacity: number;
    booked_count: number;
    location: string | null;
  }>('SELECT * FROM classes ORDER BY starts_at');

  return {
    academy,
    cachedAt: meta[0].updated_at,
    members: memberRows.map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      preferredName: null,
      role: row.role,
      status: row.status,
      dateOfBirth: null,
      pinHash: row.pin_hash,
      qrToken: row.qr_token,
      waiverValid: row.waiver_valid === 1,
      waiverExpiresAt: row.waiver_expires_at,
      membershipStatus: row.membership_status,
      membershipPlanType: row.membership_plan_type,
      membershipPeriodEnd: null,
      classesUsedInPeriod: 0,
      classesPerWeek: row.classes_per_week,
      classPackCount: row.class_pack_count,
    })),
    classes: classRows.map((row) => ({
      id: row.id,
      programId: row.program_id,
      programName: row.program_name,
      title: row.title,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      capacity: row.capacity,
      bookedCount: row.booked_count,
      location: row.location,
    })),
  };
}

/**
 * PIN hashing must match the server exactly: `sha256("<academyId>:<pin>")`.
 * Both sides compute it, so the kiosk can match offline without ever storing
 * a plaintext PIN.
 */
export async function hashPin(academyId: string, pin: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${academyId}:${pin}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function todayClasses(classes: KioskClass[]): KioskClass[] {
  const today = new Date().toDateString();
  return classes.filter((item) => new Date(item.startsAt).toDateString() === today);
}

/** The class a walk-in is most likely checking into right now. */
export function suggestedClass(classes: KioskClass[]): KioskClass | null {
  const now = Date.now();
  const upcoming = classes
    .filter((item) => new Date(item.endsAt).getTime() > now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return upcoming[0] ?? null;
}
