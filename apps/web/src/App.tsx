/**
 * The shell. Screens land here in the next pull request; for now this proves the three
 * session states are reachable and that nothing renders before the boot refresh answers.
 */
import { useSession } from "./auth/useSession";

export function App(): React.ReactNode {
  const { status, signOut } = useSession();

  if (status === "loading") {
    // Not a spinner yet, and deliberately not the login screen: showing that here is the
    // flash-on-every-reload bug the third state exists to prevent (ADR-0021).
    return <p role="status">Checking your session…</p>;
  }

  if (status === "anonymous") {
    return <p>Signed out.</p>;
  }

  return (
    <div>
      <p>Signed in.</p>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}
