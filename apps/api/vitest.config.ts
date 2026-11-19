import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The suite shares one SQLite copy, so files must not interleave writes.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      // The in-process scheduler is started by main.ts only, never by buildApp,
      // so tests never spawn timers — we just want the request log quiet.
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
    },
  },
});
