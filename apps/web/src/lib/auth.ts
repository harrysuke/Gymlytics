import { computed, reactive } from 'vue';
import { ApiError, api, clearTokens, getAccessToken, hasStoredSession, setTokens } from './api';

export interface SessionUser {
  id: string;
  email: string | null;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
}

export interface SessionAcademy {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
  academy: SessionAcademy;
}

export const session = reactive<{
  user: SessionUser | null;
  academy: SessionAcademy | null;
  ready: boolean;
  error: string | null;
}>({
  user: null,
  academy: null,
  ready: false,
  error: null,
});

export const isAuthenticated = computed(() => session.user !== null);

/** Roles that may see the admin console at all. */
const STAFF_ROLES = ['owner', 'admin', 'coach', 'staff'];

export const isStaff = computed(() => Boolean(session.user && STAFF_ROLES.includes(session.user.role)));

export function hasRole(...roles: string[]): boolean {
  return Boolean(session.user && roles.includes(session.user.role));
}

/** Owner/admin can mutate everything; coach/staff get a read-mostly console. */
export const canManage = computed(() => hasRole('owner', 'admin'));
export const canFrontDesk = computed(() => hasRole('owner', 'admin', 'staff'));
export const canCoach = computed(() => hasRole('owner', 'admin', 'coach'));

export async function login(email: string, password: string, academySlug: string): Promise<void> {
  session.error = null;
  try {
    const { data } = await api.post<LoginResponse>(
      '/v1/auth/login',
      { email, password, academySlug },
      { anonymous: true },
    );
    setTokens(data.accessToken, data.refreshToken);
    session.user = data.user;
    session.academy = data.academy;
  } catch (error) {
    session.error = error instanceof ApiError ? error.message : 'Sign-in failed';
    throw error;
  }
}

export async function logout(): Promise<void> {
  try {
    await api.post('/v1/auth/logout', {});
  } catch {
    // Best-effort: the local session is cleared either way.
  }
  clearTokens();
  session.user = null;
  session.academy = null;
}

/** Restore a stored session on boot. Called once by the router guard. */
export async function restoreSession(): Promise<void> {
  if (session.ready) return;
  if (!hasStoredSession() && !getAccessToken()) {
    session.ready = true;
    return;
  }
  try {
    const { data } = await api.get<{ user: SessionUser; academy: SessionAcademy }>('/v1/auth/me');
    session.user = data.user;
    session.academy = data.academy;
  } catch {
    clearTokens();
    session.user = null;
    session.academy = null;
  } finally {
    session.ready = true;
  }
}

export function displayName(user: { firstName: string; lastName: string } | null | undefined): string {
  return user ? `${user.firstName} ${user.lastName}`.trim() : '—';
}

export function initials(user: { firstName: string; lastName: string } | null | undefined): string {
  if (!user) return '?';
  return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
}
