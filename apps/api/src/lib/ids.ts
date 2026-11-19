/**
 * Ids are generated in `@gymlytics/db` so the schema's `$defaultFn` and the API
 * share one implementation. Re-exported here to keep call sites stable.
 */
export { uuidv7 } from '@gymlytics/db';
