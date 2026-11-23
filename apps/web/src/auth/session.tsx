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
  /**
   * Anonymous because the person signed out here, rather than because they never signed in or
   * their session ended: the page that says so stands until they choose to sign in again.
   */
  signedOut: boolean;
  signIn: (credentials: Credentials) => Promise<void>;
  /** Rejects when the server did not end the session, which then is still open. */
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

    refreshSession().then(
      (token) => {
        if (!cancelled) setStatus(token === null ? "anonymous" : "authenticated");
      },
      () => {
        // The server could not answer, so whether there is a session is unknown. Never the
        // sign-in screen for somebody who may be signed in (ADR-0021): the week says it could
        // not reach the server, and its retry settles the session once the server answers.
        if (!cancelled) setStatus("authenticated");
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const [signedOut, setSignedOut] = useState(false);

  const signIn = useCallback(async (credentials: Credentials) => {
    await auth.login(credentials);
    setSignedOut(false);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
    // Not optimistic: the screen says "You’re signed out of this browser", and only the
    // server's answer makes that true, since only it can clear the HttpOnly cookie that would
    // sign the person back in on the next reload (decided on 2026-11-23).
    await auth.logout();
    setSignedOut(true);
    setStatus("anonymous");
  }, []);

  const value = useMemo(
    () => ({ status, signedOut, signIn, signOut }),
    [status, signedOut, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
