import { syncChanges, type Db } from '@gymlytics/db';
import { serverClock } from './hlc';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Executor = Db | Tx;

export type SyncEntity =
  | 'attendance_log'
  | 'booking'
  | 'waiver'
  | 'dropin_user'
  | 'member'
  | 'retail_transaction';

export interface ChangeInput {
  academyId: string;
  entity: SyncEntity;
  entityId: string;
  operation: 'insert' | 'update' | 'delete';
  payload: Record<string, unknown>;
  originDeviceId?: string;
  version?: number;
}

/**
 * Append to the server change feed. Call this in the same transaction as the
 * domain write so a kiosk can never pull a row that does not exist, or miss
 * a row that does.
 */
export function recordChange(db: Executor, input: ChangeInput): string {
  const hlc = serverClock.tick();
  db.insert(syncChanges)
    .values({
      academyId: input.academyId,
      entity: input.entity,
      entityId: input.entityId,
      operation: input.operation,
      payload: input.payload,
      hlc,
      version: input.version ?? 1,
      originDeviceId: input.originDeviceId ?? 'server',
    })
    .run();
  return hlc;
}
