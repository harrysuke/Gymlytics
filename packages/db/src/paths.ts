import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * One canonical SQLite file for the whole monorepo.
 *
 * Every entry point (API, drizzle-kit, migrate, seed) used to default to
 * `file:./data/gymlytics.db`, which resolves against the *current working
 * directory* — so `pnpm --filter @gymlytics/db migrate` and `pnpm dev` in
 * `apps/api` would silently create two different databases. We instead anchor
 * the default at the workspace root, discovered by walking up for
 * `pnpm-workspace.yaml`, so all processes agree on one file no matter where
 * they are launched from.
 */
export function findWorkspaceRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

/** `DATABASE_URL` wins; otherwise `<workspaceRoot>/data/gymlytics.db`. */
export function resolveDatabaseUrl(): string {
  const explicit = process.env.DATABASE_URL;
  if (explicit && explicit.length > 0) return explicit;
  return `file:${join(findWorkspaceRoot(), 'data', 'gymlytics.db')}`;
}
