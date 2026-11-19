import { defineConfig } from 'drizzle-kit';
import { resolveDatabaseUrl } from './src/paths';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: resolveDatabaseUrl(),
  },
  verbose: true,
  strict: true,
});
