import { z } from 'zod';
import { uuidSchema } from './common';

export const loginSchema = z.object({
  academySlug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20) });

/**
 * Kiosk / waiver-tablet bootstrap. The device key is provisioned once by an
 * admin and rotated when a tablet is retired; it only mints a scoped token,
 * never an owner session.
 */
export const deviceSessionSchema = z.object({
  academySlug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  deviceId: z.string().min(3).max(80),
  deviceKey: z.string().min(8).max(200),
});
export type DeviceSessionInput = z.infer<typeof deviceSessionSchema>;

/** Guardian authenticates to manage a dependent's booking/waiver. */
export const guardianPinSchema = z.object({
  academyId: uuidSchema,
  dependentId: uuidSchema,
  pin: z.string().regex(/^\d{4,8}$/),
});
export type GuardianPinInput = z.infer<typeof guardianPinSchema>;

export const authUserSchema = z.object({
  id: uuidSchema,
  academyId: uuidSchema,
  role: z.enum(['owner', 'admin', 'coach', 'staff', 'student', 'guardian', 'dropin']),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email().nullable(),
  permissions: z.array(z.string()),
});
export type AuthUser = z.infer<typeof authUserSchema>;
