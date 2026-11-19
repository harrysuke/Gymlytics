/**
 * Expo inlines `process.env.EXPO_PUBLIC_*` at bundle time. Set
 * EXPO_PUBLIC_API_URL to your machine's LAN address when testing on a device
 * (localhost resolves to the phone itself, not your laptop).
 */
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export const ACADEMY_SLUG: string = process.env.EXPO_PUBLIC_ACADEMY_SLUG ?? 'gymlytics-demo';
