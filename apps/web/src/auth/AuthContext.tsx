import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, setUnauthenticatedHandler, tokens } from "../api/client";

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  roles: string[];
  photoUrl?: string | null;
  student?: {
    registrationNo: string;
    rollNo: number | null;
    sectionId: string | null;
    sectionName: string | null;
  } | null;
}

interface LoginResult {
  accessToken: string;
  refreshToken: string;
  /** FR-REG-040 — a provisioned account must set its own password first. */
  mustChangePassword: boolean;
  user: AuthUser;
}

interface AuthState {
  user: AuthUser | null;
  mustChangePassword: boolean;
  /** Distinguishes "checking your session" from "signed out" on first paint. */
  initialising: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  completePasswordChange: () => void;
  hasRole: (...roles: string[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [initialising, setInitialising] = useState(true);

  const clear = useCallback(() => {
    tokens.clear();
    setUser(null);
    setMustChangePassword(false);
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(clear);
  }, [clear]);

  /**
   * Restores a session on reload.
   *
   * The access token lives in memory only, so a refresh of the page always
   * starts without one. The refresh token in storage is what makes the
   * session survive, and /auth/me is what proves it is still valid — the
   * server may have revoked it (SEC-SES-007) since the tab was last open.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!tokens.getRefresh()) {
        setInitialising(false);
        return;
      }
      try {
        const me = await api.get<{
          userId: string;
          fullName: string;
          email: string;
          photoUrl: string | null;
          mustChangePassword: boolean;
          roles: string[];
          student: AuthUser["student"];
        }>("/auth/me");
        if (cancelled) return;
        setUser({
          id: me.userId,
          fullName: me.fullName,
          email: me.email,
          photoUrl: me.photoUrl,
          roles: me.roles,
          student: me.student,
        });
        // FR-REG-040 — the requirement must survive a page reload, not only
        // hold immediately after login.
        setMustChangePassword(me.mustChangePassword);
      } catch {
        if (!cancelled) clear();
      } finally {
        if (!cancelled) setInitialising(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clear]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.post<LoginResult>("/auth/login", {
      email,
      password,
      deviceLabel: navigator.userAgent.slice(0, 120),
    });

    tokens.setAccess(result.accessToken);
    tokens.setRefresh(result.refreshToken);
    setUser(result.user);
    setMustChangePassword(result.mustChangePassword);
  }, []);

  const signOut = useCallback(async () => {
    // Best effort: SEC-SES-004 wants the session ended server-side, but a
    // network failure must not leave the user stuck in the app.
    await api.post("/auth/logout").catch(() => undefined);
    clear();
  }, [clear]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      mustChangePassword,
      initialising,
      signIn,
      signOut,
      completePasswordChange: () => setMustChangePassword(false),
      hasRole: (...roles: string[]) => !!user && roles.some((r) => user.roles.includes(r)),
    }),
    [user, mustChangePassword, initialising, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
