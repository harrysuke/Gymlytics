const DEV_SECRET = 'gymlytics-dev-secret-change-me-32-bytes-minimum';

function int(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: int('API_PORT', 3000),
  host: process.env.API_HOST ?? '0.0.0.0',
  publicApiUrl: process.env.PUBLIC_API_URL ?? 'http://localhost:3000',
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','),
  jwtSecret: process.env.JWT_SECRET ?? DEV_SECRET,
  accessTokenTtlSeconds: int('ACCESS_TOKEN_TTL_SECONDS', 15 * 60),
  deviceTokenTtlSeconds: int('DEVICE_TOKEN_TTL_SECONDS', 12 * 60 * 60),
  refreshTokenTtlDays: int('REFRESH_TOKEN_TTL_DAYS', 30),
  kioskDeviceKey: process.env.KIOSK_DEVICE_KEY ?? 'dev-kiosk-key',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  jobsEnabled: (process.env.JOBS_ENABLED ?? 'true') !== 'false',
} as const;

if (env.nodeEnv === 'production' && env.jwtSecret === DEV_SECRET) {
  throw new Error('JWT_SECRET must be set to a strong random value in production');
}
