/**
 * Whether there is a session, in three states rather than two.
 *
 * The third state is the whole point. With the access token in memory (ADR-0021), a page
 * reload starts with no token and no way to know yet whether the user is signed in — the
 * answer lives in an HttpOnly cookie that only the server can read. A boolean would have to
 * guess, and it would guess "signed out", which means the login screen flashes on every
 * refresh for a user who is perfectly well signed in.
 *
 * So nothing renders until `refreshSession` has answered.
 */
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { onSessionExpired, refreshSession } from "../api/client";
import * as auth from "./api";
import type { Credentials } from "./api";

export type SessionStatus = "loading" | "authenticated" | "anonymous";

export interface Session {
  status: SessionStatus;
  signIn: (credentials: Credentials) => Promise<void>;
  signOut: () => Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [status, setStatus] = useState<SessionStatus>("loading");

  useEffect(() => {
    let cancelled = false;

    // Any request that exhausts its retry lands here, so an expired session becomes a
    // signed-out interface without every caller having to remember to handle it.
    onSessionExpired(() => {
      if (!cancelled) setStatus("anonymous");
    });

    void refreshSession().then((token) => {
      if (cancelled) return;
      setStatus(token === null ? "anonymous" : "authenticated");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (credentials: Credentials) => {
    await auth.login(credentials);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
    // Optimistic on purpose: the interface should not stay signed in while a network call
    // hangs. `logout` clears the local token whether or not the server answered.
    setStatus("anonymous");
    await auth.logout();
  }, []);

  const value = useMemo(() => ({ status, signIn, signOut }), [status, signIn, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
