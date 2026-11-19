import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { ACADEMY_SLUG } from './config';

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
  name: string;
  slug: string;
  currency: string;
  timezone: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
  academy: SessionAcademy;
}

const KEY = 'gymlytics.session';

/**
 * Tokens live in the OS keychain / keystore, never AsyncStorage: a refresh token
 * is a long-lived credential and would otherwise sit in plaintext on disk.
 */
async function persist(session: Session | null): Promise<void> {
  if (!session) {
    await SecureStore.deleteItemAsync(KEY);
    return;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export async function signIn(email: string, password: string): Promise<Session> {
  const data = await apiFetch<{
    accessToken: string;
    refreshToken: string;
    user: SessionUser;
    academy: SessionAcademy;
  }>('/v1/auth/login', {
    method: 'POST',
    anonymous: true,
    body: { email, password, academySlug: ACADEMY_SLUG },
  });

  const session: Session = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    user: data.user,
    academy: data.academy,
  };
  await persist(session);
  return session;
}

export async function signOut(session: Session | null): Promise<void> {
  if (session) {
    try {
      await apiFetch('/v1/auth/logout', {
        method: 'POST',
        token: session.accessToken,
        body: { refreshToken: session.refreshToken },
      });
    } catch {
      // Offline sign-out is still a sign-out.
    }
  }
  await persist(null);
}

/**
 * Swap the refresh token for a fresh pair. Returns null when the refresh token
 * itself is dead, which the caller treats as "signed out".
 */
export async function refresh(session: Session): Promise<Session | null> {
  try {
    const data = await apiFetch<{
      accessToken: string;
      refreshToken: string;
      user: SessionUser;
      academy: SessionAcademy;
    }>('/v1/auth/refresh', {
      method: 'POST',
      anonymous: true,
      body: { refreshToken: session.refreshToken },
    });
    const next: Session = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user ?? session.user,
      academy: data.academy ?? session.academy,
    };
    await persist(next);
    return next;
  } catch {
    return null;
  }
}

/** Called by screens: retries once through a refresh before giving up. */
export async function withAuth<T>(session: Session, run: (token: string) => Promise<T>): Promise<T> {
  try {
    return await run(session.accessToken);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status !== 401) throw error;
    const next = await refresh(session);
    if (!next) throw error;
    return run(next.accessToken);
  }
}

export function useSession(): {
  session: Session | null;
  loading: boolean;
  setSession: (next: Session | null) => void;
} {
  const [session, setSessionState] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadSession().then((stored) => {
      if (!active) return;
      setSessionState(stored);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return {
    session,
    loading,
    setSession: (next) => {
      setSessionState(next);
      void persist(next);
    },
  };
}
