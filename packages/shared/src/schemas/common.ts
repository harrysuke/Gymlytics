import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const moneyCentsSchema = z.number().int().nonnegative();
export const percentageSchema = z.number().int().min(0).max(100);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  sort: z.string().default('createdAt:desc'),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const idempotencyHeaderSchema = z.string().uuid();

/** HLC format emitted by packages/sync: <iso>-<counter>-<deviceId>. */
export const hlcSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z-\d{4}(?:-[\w-]+)?$/, 'Invalid HLC timestamp');

/** Initial pull cursor — sorts before every real HLC. */
export const GENESIS_HLC = '1970-01-01T00:00:00.000Z-0000';

export function parseJson<T>(value: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(value));
}
