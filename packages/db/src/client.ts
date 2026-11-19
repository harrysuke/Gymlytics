import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index';

/**
 * Backend database client. The kiosk uses the same schema through a
 * sqlite-wasm adapter (see packages/sync/src/adapters/local-sqlite.ts).
 */
export function createDb(connectionString: string) {
  const filename = connectionString.replace(/^file:/, '');
  if (filename !== ':memory:' && !filename.startsWith(':')) {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const sqlite = new Database(filename);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof createDb>;
