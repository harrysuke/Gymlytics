import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from './client';
import { resolveDatabaseUrl } from './paths';

const url = resolveDatabaseUrl();
const db = createDb(url);

// `new URL(...).pathname` keeps a leading slash on Windows and breaks the
// folder lookup, so resolve through fileURLToPath instead.
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

migrate(db, { migrationsFolder });
console.log(`[db] migrations applied to ${url}`);
