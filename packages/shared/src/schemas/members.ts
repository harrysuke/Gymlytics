import { z } from 'zod';
import { paginationSchema, uuidSchema } from './common';

export const USER_ROLE_VALUES = [
  'owner',
  'admin',
  'coach',
  'staff',
  'student',
  'guardian',
  'dropin',
] as const;

export const USER_STATUS_VALUES = ['active', 'inactive', 'frozen', 'pending_waiver'] as const;

export const FAMILY_RELATIONSHIP_VALUES = [
  'parent',
  'guardian',
  'spouse',
  'sibling',
  'child',
  'other',
] as const;

const optionalPin = z
  .string()
  .regex(/^\d{4,8}$/, 'PIN must be 4 to 8 digits')
  .optional();

export const createMemberSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  preferredName: z.string().max(80).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(6).max(30).optional(),
  dateOfBirth: z.string().date().optional(),
  gender: z.enum(['male', 'female', 'other', 'undisclosed']).optional(),
  role: z.enum(USER_ROLE_VALUES).default('student'),
  status: z.enum(USER_STATUS_VALUES).default('active'),
  pin: optionalPin,
  notes: z.string().max(2_000).optional(),
  medicalNotes: z.string().max(2_000).optional(),
  emergencyContactName: z.string().max(120).optional(),
  emergencyContactPhone: z.string().max(30).optional(),
  guardianIds: z.array(uuidSchema).max(4).default([]),
});
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = createMemberSchema
  .partial()
  .extend({ pin: optionalPin })
  .omit({ guardianIds: true });
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const memberListQuerySchema = paginationSchema.extend({
  q: z.string().max(100).optional(),
  status: z.enum(USER_STATUS_VALUES).optional(),
  role: z.enum(USER_ROLE_VALUES).optional(),
  programId: uuidSchema.optional(),
});
export type MemberListQuery = z.infer<typeof memberListQuerySchema>;

export const familyLinkSchema = z.object({
  guardianId: uuidSchema,
  dependentId: uuidSchema,
  relationship: z.enum(FAMILY_RELATIONSHIP_VALUES).default('guardian'),
  isPrimaryBilling: z.boolean().default(false),
  canSignWaivers: z.boolean().default(true),
  canViewProgress: z.boolean().default(true),
  canBookClasses: z.boolean().default(true),
});
export type FamilyLinkInput = z.infer<typeof familyLinkSchema>;

export const createGuardianSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email(),
  phone: z.string().min(6).max(30).optional(),
  password: z.string().min(8).max(128).optional(),
});
export type CreateGuardianInput = z.infer<typeof createGuardianSchema>;
