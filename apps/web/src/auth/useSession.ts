import { useContext } from "react";

import { SessionContext, type Session } from "./session";

/** The session, or a loud failure if the provider is missing. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error("useSession must be used inside a SessionProvider.");
  }
  return session;
}
