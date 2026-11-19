import { z } from 'zod';
import { uuidSchema } from './common';

/**
 * Everything the tablet needs to run a full front desk shift with the Wi-Fi
 * off. PIN hashes are intentionally included (never plaintext PINs): the
 * kiosk must match them locally. They are scoped to one academy and the
 * kiosk token is revocable.
 */
export const kioskMemberSchema = z.object({
  id: uuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  preferredName: z.string().nullable(),
  role: z.string(),
  status: z.string(),
  dateOfBirth: z.string().nullable(),
  pinHash: z.string().nullable(),
  qrToken: z.string().nullable(),
  waiverValid: z.boolean(),
  waiverExpiresAt: z.string().nullable(),
  membershipStatus: z.string().nullable(),
  membershipPlanType: z.string().nullable(),
  membershipPeriodEnd: z.string().nullable(),
  classesUsedInPeriod: z.number().int().default(0),
  classesPerWeek: z.number().int().nullable(),
  classPackCount: z.number().int().nullable(),
});
export type KioskMember = z.infer<typeof kioskMemberSchema>;

export const kioskClassSchema = z.object({
  id: uuidSchema,
  programId: uuidSchema,
  programName: z.string(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  capacity: z.number().int(),
  bookedCount: z.number().int(),
  location: z.string().nullable(),
});
export type KioskClass = z.infer<typeof kioskClassSchema>;

export const kioskBootstrapSchema = z.object({
  academy: z.object({
    id: uuidSchema,
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    currency: z.string(),
    logoUrl: z.string().nullable(),
  }),
  members: z.array(kioskMemberSchema),
  classes: z.array(kioskClassSchema),
  serverHlc: z.string(),
  generatedAt: z.string(),
});
export type KioskBootstrap = z.infer<typeof kioskBootstrapSchema>;

export const dropInRegistrationSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  phone: z.string().min(6).max(30),
  email: z.string().email().optional(),
  programId: uuidSchema.optional(),
  classId: uuidSchema.optional(),
  dayPassCents: z.number().int().nonnegative(),
  provider: z.enum(['stripe', 'billplz', 'ipay88', 'manual']).default('manual'),
  waiverSigned: z.literal(true),
  idempotencyKey: uuidSchema,
});
export type DropInRegistrationInput = z.infer<typeof dropInRegistrationSchema>;
