import { z } from 'zod';
import { paginationSchema, uuidSchema } from './common';

export const createBookingSchema = z.object({
  academyId: uuidSchema.optional(),
  classId: uuidSchema,
  userId: uuidSchema,
  bookedFor: uuidSchema.optional(), // guardian booking for a dependent
  source: z.enum(['web', 'mobile', 'kiosk', 'admin']).default('web'),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const cancelBookingSchema = z.object({
  academyId: uuidSchema,
  bookingId: uuidSchema,
  reason: z.string().max(300).optional(),
});

export const classListQuerySchema = paginationSchema.extend({
  academyId: uuidSchema.optional(),
  programId: uuidSchema.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  availableOnly: z.coerce.boolean().default(false),
});
export type ClassListQuery = z.infer<typeof classListQuerySchema>;

export const createClassSchema = z.object({
  programId: uuidSchema,
  templateId: uuidSchema.optional(),
  coachId: uuidSchema.optional(),
  title: z.string().min(2).max(120),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  capacity: z.number().int().min(1).max(300),
  location: z.string().max(120).optional(),
  notes: z.string().max(2_000).optional(),
});
export type CreateClassInput = z.infer<typeof createClassSchema>;

export const classRosterQuerySchema = z.object({
  includeCancelled: z.coerce.boolean().default(false),
});

export const attendanceQuerySchema = paginationSchema.extend({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  programId: uuidSchema.optional(),
});

export const availabilitySchema = z.object({
  classId: uuidSchema,
  capacity: z.number().int(),
  bookedCount: z.number().int(),
  waitlistCount: z.number().int(),
  spotsLeft: z.number().int(),
  canBook: z.boolean(),
  reason: z.string().optional(),
});
export type Availability = z.infer<typeof availabilitySchema>;
