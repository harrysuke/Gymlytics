import { HttpSyncTransport, SqliteLocalDatabase, SyncEngine, type SyncState } from '@gymlytics/sync';
import { getKioskSql } from './db';
import { loadSession } from './kiosk';

export const API_URL: string = import.meta.env.VITE_API_URL ?? '';
export const DEVICE_ID: string = import.meta.env.VITE_KIOSK_DEVICE_ID ?? 'kiosk-lobby-01';

export interface KioskRuntime {
  engine: SyncEngine;
  sql: Awaited<ReturnType<typeof getKioskSql>>;
  localDb: SqliteLocalDatabase;
  academyId: string;
  deviceId: string;
}

let runtime: Promise<KioskRuntime> | null = null;

/**
 * Boot the offline engine for the paired device.
 *
 * The academy id comes from the pairing session, never from a build-time
 * constant — a kiosk that pointed at the wrong tenant would write check-ins
 * into another academy's ledger.
 */
export function getKioskRuntime(onStateChange?: (state: SyncState) => void): Promise<KioskRuntime> {
  runtime ??= (async () => {
    const session = loadSession();
    if (!session) throw new Error('Kiosk is not paired with an academy');

    const sql = await getKioskSql();
    const localDb = new SqliteLocalDatabase(sql);
    const transport = new HttpSyncTransport(API_URL, async () => loadSession()?.token ?? null);
    const engine = new SyncEngine({
      db: localDb,
      transport,
      academyId: session.academyId,
      deviceId: session.deviceId,
      batchSize: 100,
      pushIntervalMs: 5_000,
      pullIntervalMs: 15_000,
      ...(onStateChange ? { onStateChange } : {}),
    });
    engine.start();
    return { engine, sql, localDb, academyId: session.academyId, deviceId: session.deviceId };
  })();
  return runtime;
}

/** Drop the cached runtime — call after re-pairing or signing the kiosk out. */
export function resetKioskRuntime(): void {
  const pending = runtime;
  runtime = null;
  void pending?.then((value) => value.engine.stop()).catch(() => undefined);
}
