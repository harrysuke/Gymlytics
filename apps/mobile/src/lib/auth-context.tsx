import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadSession, signIn as doSignIn, signOut as doSignOut, type Session } from '../lib/session';

interface AuthValue {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  replace: (session: Session | null) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadSession().then((stored) => {
      if (!active) return;
      setSession(stored);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const next = await doSignIn(email, password);
    setSession(next);
  }, []);

  const signOut = useCallback(async () => {
    await doSignOut(session);
    setSession(null);
  }, [session]);

  const value = useMemo<AuthValue>(
    () => ({ session, loading, signIn, signOut, replace: setSession }),
    [session, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Screens call this; it always has a session or the router has redirected. */
export function useAuthedSession(): Session {
  const { session } = useAuth();
  if (!session) throw new Error('No active session');
  return session;
}
