/**
 * The Menu: who is signed in, the zone every day is read in, and the way out (ADR-0052).
 *
 * The same at every width, as the round drew it: a panel under the button from 640px, a sheet
 * from the bottom of the screen below that. It is a native modal dialog, so the browser makes
 * the page behind it inert, keeps focus inside, and closes it on Esc; the code here only opens
 * it and puts focus back on the button once it closes, however it closed, unless it closed to
 * go to Settings, whose heading the router focuses instead.
 *
 * Signing out keeps it open until the server has answered: "Signing out…" and a sign-out that
 * did not happen need somewhere to be said, and the drawing closes it at once.
 */
import { useId, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import styles from "./Menu.module.css";
import { SignOutButton } from "./SignOutButton";

interface Props {
  email: string;
  timezone: string;
  /** Resolves once the server has ended the session; rejects when it did not. */
  onSignOut: () => Promise<void>;
}

export function Menu({ email, timezone, onSignOut }: Props): React.ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const heading = useId();
  const navigate = useNavigate();
  const here = useLocation().pathname === "/settings";
  // Set when it closes to go to Settings: the close event comes after the page has changed,
  // and putting focus back on the button then would take it off the page's heading.
  const leaving = useRef(false);

  function close(): void {
    dialog.current?.close();
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          leaving.current = false;
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        Menu
      </button>
      {/* The click handler closes on a click that lands on the dialog itself rather than on
          anything in it, which is the backdrop. It is a pointer's shortcut for Close, and the
          keyboard has that twice over: Esc, and the button. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <dialog
        ref={dialog}
        className={styles.menu}
        aria-labelledby={heading}
        onClose={() => {
          setOpen(false);
          if (!leaving.current) button.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className={styles.body}>
          <div className={styles.head}>
            <h2 id={heading} className={styles.title}>
              Menu
            </h2>
            <button type="button" className={styles.action} onClick={close}>
              Close
            </button>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Signed in as</dt>
              <dd>{email}</dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>{timezone}</dd>
            </div>
          </dl>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.settings}
              aria-current={here ? "page" : undefined}
              onClick={() => {
                // Already there, it only closes, as Close does.
                leaving.current = !here;
                close();
                if (!here) void navigate("/settings");
              }}
            >
              <span>Settings</span>
              <span aria-hidden="true">›</span>
            </button>
            <SignOutButton className={styles.action} onSignOut={onSignOut} />
          </div>
        </div>
      </dialog>
    </>
  );
}
