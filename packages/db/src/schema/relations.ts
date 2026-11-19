import { relations } from 'drizzle-orm';
import { academies } from './tenancy';
import { authSessions } from './auth';
import { familyLinks, users } from './users';
import { beltRanks, curriculumRequirements, curriculumTechniques, programs } from './programs';
import { bookings, classes, classTemplates, classTechniques } from './classes';
import {
  attendanceLogs,
  appliedMutations,
  syncChanges,
  syncCursors,
  syncOutbox,
} from './attendance';
import { promotions } from './ranks';
import { waivers, waiverTemplates } from './waivers';
import {
  memberships,
  membershipPlans,
  paymentMethods,
  paymentRetries,
} from './billing';
import { retailProducts, transactionItems, transactions } from './commerce';
import { notificationJobs, webhookEvents } from './operations';

export const academiesRelations = relations(academies, ({ many }) => ({
  users: many(users),
  programs: many(programs),
  classes: many(classes),
  memberships: many(memberships),
  transactions: many(transactions),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  academy: one(academies, { fields: [users.academyId], references: [academies.id] }),
  guardians: many(familyLinks, { relationName: 'dependent' }),
  dependents: many(familyLinks, { relationName: 'guardian' }),
  bookings: many(bookings),
  attendance: many(attendanceLogs),
  memberships: many(memberships),
  waivers: many(waivers),
  promotions: many(promotions),
  paymentMethods: many(paymentMethods),
  sessions: many(authSessions),
}));

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(users, { fields: [authSessions.userId], references: [users.id] }),
  academy: one(academies, { fields: [authSessions.academyId], references: [academies.id] }),
}));

export const familyLinksRelations = relations(familyLinks, ({ one }) => ({
  guardian: one(users, {
    fields: [familyLinks.guardianId],
    references: [users.id],
    relationName: 'guardian',
  }),
  dependent: one(users, {
    fields: [familyLinks.dependentId],
    references: [users.id],
    relationName: 'dependent',
  }),
}));

export const programsRelations = relations(programs, ({ one, many }) => ({
  academy: one(academies, { fields: [programs.academyId], references: [academies.id] }),
  ranks: many(beltRanks),
  techniques: many(curriculumTechniques),
  classes: many(classes),
}));

export const beltRanksRelations = relations(beltRanks, ({ one, many }) => ({
  program: one(programs, { fields: [beltRanks.programId], references: [programs.id] }),
  requirements: many(curriculumRequirements),
}));

export const curriculumTechniquesRelations = relations(curriculumTechniques, ({ one, many }) => ({
  program: one(programs, { fields: [curriculumTechniques.programId], references: [programs.id] }),
  requirements: many(curriculumRequirements),
}));

export const curriculumRequirementsRelations = relations(curriculumRequirements, ({ one }) => ({
  rank: one(beltRanks, { fields: [curriculumRequirements.beltRankId], references: [beltRanks.id] }),
  technique: one(curriculumTechniques, {
    fields: [curriculumRequirements.techniqueId],
    references: [curriculumTechniques.id],
  }),
}));

export const classTemplatesRelations = relations(classTemplates, ({ one, many }) => ({
  program: one(programs, { fields: [classTemplates.programId], references: [programs.id] }),
  coach: one(users, { fields: [classTemplates.coachId], references: [users.id] }),
  classes: many(classes),
}));

export const classesRelations = relations(classes, ({ one, many }) => ({
  academy: one(academies, { fields: [classes.academyId], references: [academies.id] }),
  program: one(programs, { fields: [classes.programId], references: [programs.id] }),
  template: one(classTemplates, { fields: [classes.templateId], references: [classTemplates.id] }),
  coach: one(users, { fields: [classes.coachId], references: [users.id] }),
  bookings: many(bookings),
  attendance: many(attendanceLogs),
  techniques: many(classTechniques),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  class: one(classes, { fields: [bookings.classId], references: [classes.id] }),
  user: one(users, { fields: [bookings.userId], references: [users.id] }),
}));

export const attendanceRelations = relations(attendanceLogs, ({ one }) => ({
  class: one(classes, { fields: [attendanceLogs.classId], references: [classes.id] }),
  user: one(users, { fields: [attendanceLogs.userId], references: [users.id] }),
  booking: one(bookings, { fields: [attendanceLogs.bookingId], references: [bookings.id] }),
}));

export const promotionsRelations = relations(promotions, ({ one }) => ({
  user: one(users, { fields: [promotions.userId], references: [users.id] }),
  program: one(programs, { fields: [promotions.programId], references: [programs.id] }),
  fromRank: one(beltRanks, { fields: [promotions.fromBeltRankId], references: [beltRanks.id] }),
  toRank: one(beltRanks, { fields: [promotions.toBeltRankId], references: [beltRanks.id] }),
}));

export const waiversRelations = relations(waivers, ({ one }) => ({
  user: one(users, { fields: [waivers.userId], references: [users.id] }),
  guardian: one(users, { fields: [waivers.guardianUserId], references: [users.id] }),
}));

export const waiverTemplatesRelations = relations(waiverTemplates, ({ one }) => ({
  academy: one(academies, { fields: [waiverTemplates.academyId], references: [academies.id] }),
}));

export const membershipPlansRelations = relations(membershipPlans, ({ many }) => ({
  memberships: many(memberships),
}));

export const membershipsRelations = relations(memberships, ({ one, many }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  plan: one(membershipPlans, { fields: [memberships.planId], references: [membershipPlans.id] }),
  retries: many(paymentRetries),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({ one }) => ({
  user: one(users, { fields: [paymentMethods.userId], references: [users.id] }),
}));

export const retailProductsRelations = relations(retailProducts, ({ many }) => ({
  items: many(transactionItems),
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  user: one(users, { fields: [transactions.userId], references: [users.id] }),
  payer: one(users, { fields: [transactions.payerId], references: [users.id] }),
  membership: one(memberships, {
    fields: [transactions.membershipId],
    references: [memberships.id],
  }),
  items: many(transactionItems),
}));

export const transactionItemsRelations = relations(transactionItems, ({ one }) => ({
  transaction: one(transactions, {
    fields: [transactionItems.transactionId],
    references: [transactions.id],
  }),
  product: one(retailProducts, {
    fields: [transactionItems.productId],
    references: [retailProducts.id],
  }),
}));

// Sync-support tables (kept in the barrel for tooling completeness)
export const syncCursorsRelations = relations(syncCursors, ({ one }) => ({
  academy: one(academies, { fields: [syncCursors.academyId], references: [academies.id] }),
}));
export const syncOutboxRelations = relations(syncOutbox, () => ({}));
export const appliedMutationsRelations = relations(appliedMutations, () => ({}));
export const syncChangesRelations = relations(syncChanges, ({ one }) => ({
  academy: one(academies, { fields: [syncChanges.academyId], references: [academies.id] }),
}));
export const webhookEventsRelations = relations(webhookEvents, ({ one }) => ({
  academy: one(academies, { fields: [webhookEvents.academyId], references: [academies.id] }),
}));
export const notificationJobsRelations = relations(notificationJobs, ({ one }) => ({
  recipient: one(users, { fields: [notificationJobs.recipientUserId], references: [users.id] }),
}));
export const classTechniquesRelations = relations(classTechniques, ({ one }) => ({
  class: one(classes, { fields: [classTechniques.classId], references: [classes.id] }),
  technique: one(curriculumTechniques, {
    fields: [classTechniques.techniqueId],
    references: [curriculumTechniques.id],
  }),
}));
