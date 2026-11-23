/**
 * What signing out of this browser leaves on screen (settings.dc.html).
 *
 * It says what did not happen, because that is what a person worries about after pressing it:
 * nothing was deleted, and the other devices are still signed in. It stands until they choose
 * to sign in again, which opens the sign-in screen on the week's address, so signing back in
 * lands on the week rather than on the page they left from.
 *
 * Focus goes to its heading: it took the screen because of what the person just pressed.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { AuthScreen } from "./AuthScreen";
import styles from "./SignedOut.module.css";

export function SignedOut(): React.ReactNode {
  const heading = useRef<HTMLHeadingElement>(null);
  const navigate = useNavigate();
  const [again, setAgain] = useState(false);

  useEffect(() => {
    // Then on the sign-in screen's heading, as the router would put it: never a field, since
    // that screen puts focus in none on its own (sign-in.dc.html).
    const target = again ? document.querySelector<HTMLElement>("h1") : heading.current;
    target?.setAttribute("tabindex", "-1");
    target?.focus();
  }, [again]);

  if (again) return <AuthScreen />;

  return (
    <main className={styles.page}>
      <h1 ref={heading} tabIndex={-1} className={styles.title}>
        You’re signed out of this browser
      </h1>
      <p className={styles.lede}>
        Nothing was deleted. Your week, your plans and your settings are where you left them, and
        your other devices are still signed in.
      </p>
      <button
        type="button"
        className={styles.primary}
        onClick={() => {
          void navigate("/", { replace: true });
          setAgain(true);
        }}
      >
        Sign in
      </button>
    </main>
  );
}
