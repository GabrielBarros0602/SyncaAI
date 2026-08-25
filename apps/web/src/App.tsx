/**
 * The shell.
 *
 * Three session states, and the third is the whole reason it is not a boolean: with the
 * access token in memory, a reload starts knowing nothing, and guessing "signed out" would
 * flash the login screen at somebody who is perfectly well signed in (ADR-0021).
 */
import { useSession } from "./auth/useSession";
import { WeekScreen } from "./week/WeekScreen";
import { WeekSkeleton } from "./week/WeekSkeleton";

export function App(): React.ReactNode {
  const { status } = useSession();

  return (
    <div
      data-theme="dark"
      data-density="default"
      data-accent="default"
      data-motion="default"
      style={{ minHeight: "100vh", padding: "56px 64px 96px" }}
    >
      {status === "loading" && <WeekSkeleton />}
      {status === "anonymous" && <p>Signed out.</p>}
      {status === "authenticated" && <WeekScreen />}
    </div>
  );
}
