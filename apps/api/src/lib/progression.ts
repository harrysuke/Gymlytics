import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import {
  attendanceLogs,
  beltRanks,
  classes,
  classTechniques,
  curriculumRequirements,
  programs,
  promotions,
  users,
  type Db,
} from '@gymlytics/db';
import { evaluatePromotionEligibility, type EligibilityRow } from '@gymlytics/shared';

interface RankRow {
  id: string;
  name: string;
  slug: string;
  orderIndex: number;
  maxStripes: number;
  minMonthsInRank: number;
  minClassesInRank: number;
  minMatHours: number;
}

export function computeEligibility(
  db: Db,
  academyId: string,
  userId?: string,
  programId?: string,
): EligibilityRow[] {
  const memberConditions = [
    eq(users.academyId, academyId),
    isNull(users.deletedAt),
    eq(users.status, 'active'),
  ];
  if (userId) memberConditions.push(eq(users.id, userId));
  const members = db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, createdAt: users.createdAt })
    .from(users)
    .where(and(...memberConditions))
    .all();

  const programConditions = [
    eq(programs.academyId, academyId),
    isNull(programs.deletedAt),
    eq(programs.isActive, true),
  ];
  if (programId) programConditions.push(eq(programs.id, programId));
  const programRows = db.select().from(programs).where(and(...programConditions)).all();

  const allRanks = db
    .select()
    .from(beltRanks)
    .where(and(eq(beltRanks.academyId, academyId), eq(beltRanks.isActive, true)))
    .orderBy(asc(beltRanks.orderIndex))
    .all();

  const rows: EligibilityRow[] = [];
  for (const member of members) {
    for (const program of programRows) {
      const ranks = allRanks.filter((rank) => rank.programId === program.id) as RankRow[];
      if (ranks.length === 0) continue;

      const latest = latestPromotion(db, member.id, program.id);
      const since = latest?.promotedAt ?? member.createdAt;
      const stats = attendanceSince(db, member.id, program.id, since);

      // A member only "belongs" to a program once they have a promotion in it or
      // have actually trained it. Without this guard the eligibility table is a
      // full member x program cross-product — hundreds of meaningless rows.
      if (!latest && stats.classes === 0) continue;

      const currentRank =
        (latest ? ranks.find((rank) => rank.id === latest.toBeltRankId) : undefined) ?? ranks[0]!;
      const nextRank = ranks.find((rank) => rank.orderIndex > currentRank.orderIndex) ?? null;
      const currentStripes = latest?.toStripes ?? 0;
      const required = nextRank
        ? db
            .select({ techniqueId: curriculumRequirements.techniqueId })
            .from(curriculumRequirements)
            .where(
              and(
                eq(curriculumRequirements.beltRankId, nextRank.id),
                eq(curriculumRequirements.isRequired, true),
              ),
            )
            .all()
        : [];

      const completed =
        required.length > 0
          ? db
              .select({ techniqueId: classTechniques.techniqueId })
              .from(classTechniques)
              .innerJoin(classes, eq(classes.id, classTechniques.classId))
              .innerJoin(
                attendanceLogs,
                and(
                  eq(attendanceLogs.classId, classes.id),
                  eq(attendanceLogs.userId, member.id),
                  isNull(attendanceLogs.deletedAt),
                ),
              )
              .where(
                and(
                  eq(classes.programId, program.id),
                  gt(attendanceLogs.checkedInAt, since),
                  inArray(
                    classTechniques.techniqueId,
                    required.map((r) => r.techniqueId),
                  ),
                ),
              )
              .groupBy(classTechniques.techniqueId)
              .all()
          : [];

      const result = evaluatePromotionEligibility({
        rank: currentRank,
        nextRank,
        currentStripes,
        promotedAt: since,
        classesSincePromotion: stats.classes,
        matHoursSincePromotion: Math.round(stats.minutes / 60),
        techniquesRequired: required.length,
        techniquesCompleted: completed.length,
      });

      rows.push({
        userId: member.id,
        memberName: `${member.firstName} ${member.lastName}`,
        programId: program.id,
        programName: program.name,
        currentRankId: currentRank.id,
        currentRankName: currentRank.name,
        currentStripes,
        nextRankId: nextRank?.id ?? null,
        nextRankName: nextRank?.name ?? null,
        monthsInRank: result.monthsInRank,
        classesSincePromotion: stats.classes,
        matHoursSincePromotion: Math.round(stats.minutes / 60),
        techniquesRequired: required.length,
        techniquesCompleted: completed.length,
        eligible: result.eligible,
        stripeEligible: result.stripeEligible,
        beltEligible: result.beltEligible,
        suggestedAction: result.suggestedAction,
        missing: result.missing,
      });
    }
  }
  return rows.sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.memberName.localeCompare(b.memberName));
}

function latestPromotion(db: Db, userId: string, programId: string) {
  return db
    .select()
    .from(promotions)
    .where(and(eq(promotions.userId, userId), eq(promotions.programId, programId)))
    .orderBy(desc(promotions.promotedAt))
    .limit(1)
    .get();
}

function attendanceSince(db: Db, userId: string, programId: string, since: string) {
  const row = db
    .select({
      classes: sql<number>`count(*)`,
      minutes: sql<number>`coalesce(sum((julianday(${classes.endsAt}) - julianday(${classes.startsAt})) * 24 * 60), 0)`,
    })
    .from(attendanceLogs)
    .innerJoin(classes, eq(classes.id, attendanceLogs.classId))
    .where(
      and(
        eq(attendanceLogs.userId, userId),
        eq(classes.programId, programId),
        gt(attendanceLogs.checkedInAt, since),
        isNull(attendanceLogs.deletedAt),
        inArray(attendanceLogs.status, ['checked_in', 'checked_out']),
      ),
    )
    .get();
  return { classes: row?.classes ?? 0, minutes: row?.minutes ?? 0 };
}
