import { createDb, resolveDatabaseUrl, type Db } from '@gymlytics/db';

export function databasePlugin(): Db {
  return createDb(resolveDatabaseUrl());
}
