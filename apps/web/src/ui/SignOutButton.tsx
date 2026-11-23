/**
 * "Sign out of this browser", in the Menu and on the settings page alike (settings.dc.html).
 *
 * It waits for the server, saying so, and when the server did not end the session it says that
 * too, under the button that was pressed: the person is still signed in here, and a page saying
 * otherwise would be wrong on the next reload (decided on 2026-11-23). One component, so the two
 * places cannot word either state differently.
 */
import { useId, useState } from "react";

import { ApiError } from "../api/client";
import styles from "./SignOutButton.module.css";

interface Props {
  /** The look of the place it stands in: a row of the Menu, or a section of the page. */
  className: string | undefined;
  /** Resolves once the server has ended the session; rejects when it did not. */
  onSignOut: () => Promise<void>;
}

export function SignOutButton({ className, onSignOut }: Props): React.ReactNode {
  const failureId = useId();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function signOut(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await onSignOut();
    } catch (problem) {
      // Signing out has no refusal of its own to quote: it fails only by not arriving, or by an
      // error whose `detail` is a status line ("Internal Server Error", from a proxy whose API
      // is down), which is not a sentence anybody should read.
      const why =
        problem instanceof ApiError
          ? "The server didn’t sign this browser out."
          : "Couldn’t reach the server.";
      setFailure(`${why} You’re still signed in here.`);
    } finally {
      // Gone already when it worked: the page that says so has taken the screen.
      setBusy(false);
    }
  }

  return (
    <div className={styles.group}>
      <button
        type="button"
        className={className}
        aria-busy={busy}
        aria-describedby={failure === null ? undefined : failureId}
        onClick={() => {
          void signOut();
        }}
      >
        {busy ? "Signing out…" : "Sign out of this browser"}
      </button>
      {/* In the page from the start, so the sentence is announced when it arrives. */}
      <p id={failureId} role="alert" className={styles.failure}>
        {failure}
      </p>
    </div>
  );
}
