import type { ApiError } from '../schemas/common';

export type ApiSuccess<T> = {
  ok: true;
  data: T;
  meta?: { requestId: string; serverHlc?: string; pagination?: Record<string, unknown> };
};

export type ApiFailure = { ok: false; error: ApiError };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type EntityName =
  | 'attendance_log'
  | 'booking'
  | 'waiver'
  | 'dropin_user'
  | 'member'
  | 'retail_transaction';

export interface KioskState {
  online: boolean;
  queuedCount: number;
  lastSyncedAt: string | null;
  conflicts: number;
  deviceId: string;
}
