/**
 * The shell.
 *
 * Three session states, and the third is the whole reason it is not a boolean: with the
 * access token in memory, a reload starts knowing nothing, and guessing "signed out" would
 * flash the login screen at somebody who is perfectly well signed in (ADR-0021).
 *
 * The routes are few on purpose, one per page that exists (ADR-0052). Settings, a plan and
 * the reset link join as their screens are built; an address that names nothing lands on
 * the week rather than on an empty page.
 */
import { Navigate, Route, Routes } from "react-router";

import { AuthScreen } from "./auth/AuthScreen";
import { useSession } from "./auth/useSession";
import { RouteFocus } from "./ui/RouteFocus";
import shell from "./ui/Shell.module.css";
import { WeekScreen } from "./week/WeekScreen";
import { WeekSkeleton } from "./week/WeekSkeleton";

function Home(): React.ReactNode {
  const { status } = useSession();

  return (
    // The loading week is padded like the week it turns into, so nothing moves when it does.
    <div className={status === "anonymous" ? shell.signedOut : shell.signedIn}>
      {status === "loading" && <WeekSkeleton />}
      {status === "anonymous" && <AuthScreen />}
      {status === "authenticated" && <WeekScreen />}
    </div>
  );
}

export function App(): React.ReactNode {
  return (
    <>
      <RouteFocus />
      <Routes>
        <Route path="/" element={<Home />} />
        {/* The confirmation link. AuthScreen reads its token at load and takes it out of the
            address, so this path is only ever left holding the screen it opened. */}
        <Route path="/verify" element={<Home />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
