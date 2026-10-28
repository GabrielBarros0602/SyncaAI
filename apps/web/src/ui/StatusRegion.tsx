/**
 * The one place a screen says what just happened (ADR-0052; #12 of the round's inventory).
 *
 * It sits outside every column and stays in the page, empty until something happens, so a
 * screen reader already knows it when the first notice arrives: a notice inside a day's column
 * could speak of a day that is not on screen, and one mounted only when needed may not be
 * announced at all. A notice names what it is about, its day included, for the same reason.
 *
 * A notice lasts nine seconds (ADR-0025), and its clock stops while the pointer is over it or
 * focus is inside it, so it is never taken away from somebody reading or about to press it. A
 * notice that is busy has no clock at all: it ends when the work does.
 */
import { useEffect, useRef, useState } from "react";

import styles from "./StatusRegion.module.css";

export interface Notice {
  /** A new id is a new notice, and starts a new nine seconds; a re-render is not. */
  id: string;
  text: string;
  /** Still in progress: read as aria-busy, and never timed out. */
  busy?: boolean;
  action?: {
    label: string;
    run: () => void;
    /** Ctrl+Z (⌘Z) runs it too, while the notice shows. */
    undoKey?: boolean;
  };
}

interface Props {
  notice: Notice | null;
  onExpire: () => void;
}

export const NOTICE_MS = 9000;

export function StatusRegion({ notice, onExpire }: Props): React.ReactNode {
  const [held, setHeld] = useState(false);
  const remaining = useRef(NOTICE_MS);
  // The latest of each, read when they fire, so a re-render with a new function does not
  // restart the clock or rebind the key.
  const expire = useRef(onExpire);
  const action = useRef(notice?.action);
  useEffect(() => {
    expire.current = onExpire;
    action.current = notice?.action;
  });

  const id = notice?.id ?? null;
  const busy = notice?.busy === true;

  useEffect(() => {
    remaining.current = NOTICE_MS;
  }, [id]);

  useEffect(() => {
    if (id === null || busy || held) return;
    const started = Date.now();
    const timer = setTimeout(() => {
      expire.current();
    }, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [id, busy, held]);

  useEffect(() => {
    if (id === null || busy) return;
    function onKeyDown(event: KeyboardEvent): void {
      const run = action.current;
      if (run?.undoKey !== true) return;
      const undoKeys = (event.ctrlKey || event.metaKey) && !event.shiftKey;
      if (!undoKeys || event.key.toLowerCase() !== "z") return;
      // Inside a field, Ctrl+Z belongs to the text being typed. Narrowed, not asserted: with
      // nothing focused the target is the window, which has no closest() to call.
      const target = event.target;
      const typing =
        target instanceof Element && target.closest("input, textarea, [contenteditable='true']");
      if (typing) return;
      event.preventDefault();
      run.run();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [id, busy]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={busy}
      className={styles.region}
      onMouseEnter={() => {
        setHeld(true);
      }}
      onMouseLeave={() => {
        setHeld(false);
      }}
      onFocus={() => {
        setHeld(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHeld(false);
      }}
    >
      {notice !== null && (
        <div className={styles.notice}>
          <span className={styles.text}>{notice.text}</span>
          {notice.action !== undefined && !busy && (
            <button
              type="button"
              className={styles.action}
              aria-keyshortcuts={notice.action.undoKey === true ? "Control+Z" : undefined}
              onClick={notice.action.run}
            >
              {notice.action.label}
              {/* Hidden from the name, which stays the verb; aria-keyshortcuts says the key. */}
              {notice.action.undoKey === true && (
                <kbd aria-hidden="true" className={styles.key}>
                  Ctrl Z
                </kbd>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
