/**
 * The Menu: who is signed in, the zone every day is read in, and the way out (ADR-0052).
 *
 * The same at every width, as the round drew it: a panel under the button from 640px, a sheet
 * from the bottom of the screen below that. It is a native modal dialog, so the browser makes
 * the page behind it inert, keeps focus inside, and closes it on Esc; the code here only opens
 * it and puts focus back on the button once it closes, however it closed.
 *
 * Settings joins it when the settings page is built.
 */
import { useId, useRef, useState } from "react";

import styles from "./Menu.module.css";

interface Props {
  email: string;
  timezone: string;
  onSignOut: () => void;
}

export function Menu({ email, timezone, onSignOut }: Props): React.ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const heading = useId();

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
          button.current?.focus();
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
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              close();
              onSignOut();
            }}
          >
            Sign out of this browser
          </button>
        </div>
      </dialog>
    </>
  );
}
