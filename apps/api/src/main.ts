import { buildApp } from './app';
import { env } from './lib/env';
import { startScheduler } from './jobs';
import { databasePlugin } from './plugins/db';

const db = databasePlugin();
const app = await buildApp(db);
const stopScheduler = startScheduler(db);

try {
  await app.listen({ port: env.port, host: env.host });
  app.log.info(`Gymlytics API listening on http://${env.host}:${env.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  stopScheduler();
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
