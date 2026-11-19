import { z } from 'zod';
import { uuidSchema } from './common';

/**
 * The legal text itself is NOT submitted here — only the hash of the exact
 * version the signer saw. The API renders the PDF from the versioned template.
 */
export const signWaiverSchema = z.object({
  academyId: uuidSchema,
  userId: uuidSchema,
  programId: uuidSchema.optional(),
  waiverType: z.enum(['general', 'participation', 'photo_release', 'medical', 'dropin']),
  documentVersion: z.number().int().positive(),
  documentHash: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  signatureData: z.string().min(10).max(200_000),
  signatureFormat: z.enum(['svg_path', 'png_data_uri', 'raw_points']).default('svg_path'),
  signerName: z.string().min(2).max(150),
  guardianUserId: uuidSchema.optional(),
  dateOfBirth: z.string().date().optional(),
  signedAt: z.string().datetime({ offset: true }),
  mutationId: uuidSchema,
  hlc: z.string(),
});
export type SignWaiverInput = z.infer<typeof signWaiverSchema>;

export const createWaiverTemplateSchema = z.object({
  waiverType: z.enum(['general', 'participation', 'photo_release', 'medical', 'dropin']),
  version: z.number().int().positive(),
  title: z.string().min(3).max(200),
  bodyMarkdown: z.string().min(20).max(100_000),
});
export type CreateWaiverTemplateInput = z.infer<typeof createWaiverTemplateSchema>;

export const waiverRequirementSchema = z.object({
  userId: uuidSchema,
  waiverType: z.enum(['general', 'participation', 'photo_release', 'medical', 'dropin']),
  satisfied: z.boolean(),
  signedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  documentVersion: z.number().int().optional(),
});
export type WaiverRequirement = z.infer<typeof waiverRequirementSchema>;
