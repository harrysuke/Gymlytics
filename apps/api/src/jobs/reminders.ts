import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '@gymlytics/db';
import {
  academies,
  attendanceLogs,
  bookings,
  classes,
  familyLinks,
  memberships,
  notificationJobs,
  users,
  waivers,
} from '@gymlytics/db';
import { computeEligibility } from '../lib/progression';
import { notifier, type Notifier } from '../lib/notifier';

interface Recipient {
  userId: string;
  channel: 'sms' | 'email';
  to: string;
  name: string;
}

/** Cron: every 5 minutes. Drains the durable notification queue. */
export async function runReminderJob(db: Db, sender: Notifier = notifier): Promise<number> {
  const now = new Date().toISOString();
  const due = db
    .select()
    .from(notificationJobs)
    .where(and(eq(notificationJobs.status, 'pending'), lte(notificationJobs.scheduledAt, now)))
    .limit(100)
    .all();

  let sent = 0;
  for (const job of due) {
    const payload = job.payload as { phone?: string; email?: string; message?: string };
    const to = job.channel === 'sms' ? payload.phone : payload.email;
    if (!to) {
      db.update(notificationJobs)
        .set({ status: 'cancelled', lastError: 'No contact channel on file' })
        .where(eq(notificationJobs.id, job.id))
        .run();
      continue;
    }
    try {
      await sender.send(job.channel, to, payload.message ?? 'Gymlytics reminder');
      db.update(notificationJobs)
        .set({ status: 'sent', sentAt: now })
        .where(eq(notificationJobs.id, job.id))
        .run();
      sent += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const retryAt = new Date(Date.now() + 15 * 60_000).toISOString();
      db.update(notificationJobs)
        .set({
          attempts,
          lastError: error instanceof Error ? error.message.slice(0, 500) : String(error),
          ...(attempts >= 3 ? { status: 'failed' as const } : { scheduledAt: retryAt }),
        })
        .where(eq(notificationJobs.id, job.id))
        .run();
    }
  }
  return sent;
}

export interface ScanResult {
  missedClasses: number;
  beltEligible: number;
  waiversExpiring: number;
  pastDue: number;
  freezesEnding: number;
}

/**
 * Builds the alert queue. Every insert uses a stable dedupe key so running
 * this hourly (or twice, from two API instances) cannot spam a member.
 */
export function scanReminders(db: Db, now = new Date()): ScanResult {
  const result: ScanResult = {
    missedClasses: 0,
    beltEligible: 0,
    waiversExpiring: 0,
    pastDue: 0,
    freezesEnding: 0,
  };

  const academyRows = db.select().from(academies).where(isNull(academies.deletedAt)).all();
  for (const academy of academyRows) {
    result.missedClasses += scanMissedClasses(db, academy.id, now);
    result.beltEligible += scanBeltEligibility(db, academy.id, now);
    result.waiversExpiring += scanWaivers(db, academy.id, now);
    result.pastDue += scanPastDue(db, academy.id, now);
    result.freezesEnding += scanFreezes(db, academy.id, now);
  }
  return result;
}

function scanMissedClasses(db: Db, academyId: string, now: Date): number {
  const from = new Date(now.getTime() - 48 * 3_600_000).toISOString();
  const to = new Date(now.getTime() - 3_600_000).toISOString();

  const rows = db
    .select({
      bookingId: bookings.id,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      classTitle: classes.title,
      startsAt: classes.startsAt,
    })
    .from(bookings)
    .innerJoin(classes, eq(classes.id, bookings.classId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .leftJoin(
      attendanceLogs,
      and(
        eq(attendanceLogs.classId, bookings.classId),
        eq(attendanceLogs.userId, bookings.userId),
        isNull(attendanceLogs.deletedAt),
      ),
    )
    .where(
      and(
        eq(classes.academyId, academyId),
        gte(classes.endsAt, from),
        lte(classes.endsAt, to),
        inArray(bookings.status, ['booked', 'checked_in']),
        isNull(attendanceLogs.id),
      ),
    )
    .all();

  let created = 0;
  for (const row of rows) {
    const recipient = resolveRecipient(db, row.userId);
    if (!recipient) continue;
    created += enqueue(db, {
      academyId,
      type: 'missed_class',
      recipient,
      dedupeKey: `missed:${row.bookingId}`,
      message: `We missed you at ${row.classTitle} on ${row.startsAt.slice(0, 10)}. Book your next class and keep the streak alive.`,
      payloadExtra: { classTitle: row.classTitle, startsAt: row.startsAt },
    });
  }
  return created;
}

function scanBeltEligibility(db: Db, academyId: string, now: Date): number {
  const rows = computeEligibility(db, academyId).filter((row) => row.beltEligible);
  let created = 0;
  for (const row of rows) {
    const recipient = resolveRecipient(db, row.userId);
    if (!recipient) continue;
    created += enqueue(db, {
      academyId,
      type: 'belt_eligibility',
      recipient,
      dedupeKey: `belt:${row.userId}:${row.nextRankId}:${now.toISOString().slice(0, 7)}`,
      message: `${row.memberName} is eligible for ${row.nextRankName ?? 'the next rank'} in ${row.programName}. Time in rank: ${row.monthsInRank} months.`,
      payloadExtra: { programId: row.programId, nextRankId: row.nextRankId },
    });
  }
  return created;
}

function scanWaivers(db: Db, academyId: string, now: Date): number {
  const soon = new Date(now.getTime() + 30 * 86_400_000).toISOString();
  const rows = db
    .select({
      waiverId: waivers.id,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      expiresAt: waivers.expiresAt,
    })
    .from(waivers)
    .innerJoin(users, eq(users.id, waivers.userId))
    .where(
      and(
        eq(waivers.academyId, academyId),
        eq(waivers.status, 'signed'),
        gte(waivers.expiresAt, now.toISOString()),
        lte(waivers.expiresAt, soon),
      ),
    )
    .all();

  let created = 0;
  for (const row of rows) {
    const recipient = resolveRecipient(db, row.userId);
    if (!recipient) continue;
    created += enqueue(db, {
      academyId,
      type: 'waiver_expiring',
      recipient,
      dedupeKey: `waiver:${row.waiverId}:${row.expiresAt?.slice(0, 10) ?? 'soon'}`,
      message: `${row.firstName}'s waiver expires on ${row.expiresAt?.slice(0, 10) ?? 'soon'}. Please sign a new one at the front desk.`,
      payloadExtra: { waiverId: row.waiverId, expiresAt: row.expiresAt },
    });
  }
  return created;
}

function scanPastDue(db: Db, academyId: string, now: Date): number {
  const rows = db
    .select({
      membershipId: memberships.id,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.academyId, academyId), eq(memberships.status, 'past_due')))
    .all();

  let created = 0;
  for (const row of rows) {
    const recipient = resolveRecipient(db, row.userId);
    if (!recipient) continue;
    created += enqueue(db, {
      academyId,
      type: 'payment_failed',
      recipient,
      dedupeKey: `past_due:${row.membershipId}:${now.toISOString().slice(0, 7)}`,
      message: `Your membership payment failed. Update your card to keep training without interruption.`,
      payloadExtra: { membershipId: row.membershipId },
    });
  }
  return created;
}

function scanFreezes(db: Db, academyId: string, now: Date): number {
  const soon = new Date(now.getTime() + 3 * 86_400_000).toISOString();
  const rows = db
    .select({
      membershipId: memberships.id,
      userId: users.id,
      firstName: users.firstName,
      freezeUntil: memberships.freezeUntil,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.academyId, academyId),
        eq(memberships.status, 'frozen'),
        gte(memberships.freezeUntil, now.toISOString()),
        lte(memberships.freezeUntil, soon),
      ),
    )
    .all();

  let created = 0;
  for (const row of rows) {
    const recipient = resolveRecipient(db, row.userId);
    if (!recipient) continue;
    created += enqueue(db, {
      academyId,
      type: 'freeze_ending',
      recipient,
      dedupeKey: `freeze:${row.membershipId}:${row.freezeUntil?.slice(0, 10) ?? 'soon'}`,
      message: `Your membership freeze ends on ${row.freezeUntil?.slice(0, 10) ?? 'soon'}. We'll see you on the mats.`,
      payloadExtra: { membershipId: row.membershipId },
    });
  }
  return created;
}

function resolveRecipient(db: Db, userId: string): Recipient | null {
  const user = db
    .select({ id: users.id, firstName: users.firstName, phone: users.phone, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user) return null;
  if (user.phone) return { userId: user.id, channel: 'sms', to: user.phone, name: user.firstName };
  if (user.email) return { userId: user.id, channel: 'email', to: user.email, name: user.firstName };

  const guardian = db
    .select({
      id: users.id,
      firstName: users.firstName,
      phone: users.phone,
      email: users.email,
    })
    .from(familyLinks)
    .innerJoin(users, eq(users.id, familyLinks.guardianId))
    .where(and(eq(familyLinks.dependentId, userId), eq(familyLinks.canSignWaivers, true)))
    .limit(1)
    .get();
  if (!guardian) return null;
  if (guardian.phone) {
    return { userId: guardian.id, channel: 'sms', to: guardian.phone, name: guardian.firstName };
  }
  if (guardian.email) {
    return { userId: guardian.id, channel: 'email', to: guardian.email, name: guardian.firstName };
  }
  return null;
}

function enqueue(
  db: Db,
  input: {
    academyId: string;
    type: 'missed_class' | 'belt_eligibility' | 'waiver_expiring' | 'payment_failed' | 'freeze_ending';
    recipient: Recipient;
    dedupeKey: string;
    message: string;
    payloadExtra?: Record<string, unknown>;
  },
): number {
  const inserted = db
    .insert(notificationJobs)
    .values({
      academyId: input.academyId,
      type: input.type,
      recipientUserId: input.recipient.userId,
      channel: input.recipient.channel,
      payload: {
        message: input.message,
        ...(input.recipient.channel === 'sms'
          ? { phone: input.recipient.to }
          : { email: input.recipient.to }),
        ...input.payloadExtra,
      },
      dedupeKey: input.dedupeKey,
      scheduledAt: new Date().toISOString(),
      status: 'pending',
    })
    .onConflictDoNothing()
    .returning({ id: notificationJobs.id })
    .all();
  return inserted.length;
}
