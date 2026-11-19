import type { Db } from '@gymlytics/db';
import { env } from '../lib/env';
import { paymentRegistry } from '../lib/payments';
import { runDunningJob } from './dunning';
import { runReminderJob, scanReminders } from './reminders';

/**
 * In-process scheduler. One API instance owns it today; when the platform
 * scales horizontally this becomes a Postgres advisory-lock leader election
 * (or a dedicated worker), not a code change in the jobs themselves.
 */
export function startScheduler(db: Db): () => void {
  if (!env.jobsEnabled) return () => undefined;

  const run = (name: string, fn: () => unknown | Promise<unknown>) => {
    void Promise.resolve()
      .then(fn)
      .catch((error) => console.error(`[jobs:${name}]`, error));
  };

  const timers = [
    setInterval(() => run('reminders', () => runReminderJob(db)), 60_000),
    setInterval(() => run('dunning', () => runDunningJob(db, paymentRegistry)), 15 * 60_000),
    setInterval(() => run('scan', () => scanReminders(db)), 6 * 3_600_000),
  ];

  // Kick a scan shortly after boot so a fresh deployment catches up.
  setTimeout(() => {
    run('scan', () => scanReminders(db));
    run('reminders', () => runReminderJob(db));
    run('dunning', () => runDunningJob(db, paymentRegistry));
  }, 5_000).unref?.();

  return () => timers.forEach(clearInterval);
}
