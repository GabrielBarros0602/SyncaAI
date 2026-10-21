import { useState } from "react";

import type { NewTask } from "../api/types";
import styles from "./Week.module.css";

/** A task deleted in the last nine seconds that can still be put back (ADR-0025). */
export interface Trash {
  /** The local day it was on, which is the column that shows this. */
  day: string;
  title: string;
  /** What the recreate sends, taken before the delete. */
  snapshot: NewTask;
  /** The server's sentence when the recreate was refused. Shown once; nothing retries. */
  failure: string | null;
}

interface Props {
  trash: Trash;
  onUndo: () => Promise<void>;
}

/**
 * `deleted · title` and the way back, where the design puts it: in the column, below its rows.
 *
 * A polite live region naming the task, because the row that was focused is gone and somebody
 * who cannot see the column needs to hear what happened to it and that it can be undone.
 *
 * The undo is a recreate, and the task's start can pass while this is on screen, so the server
 * can still refuse it. Its sentence replaces the button rather than sitting beside it: there is
 * nothing left to press that would work.
 */
export function TrashNotice({ trash, onUndo }: Props): React.ReactNode {
  const [restoring, setRestoring] = useState(false);

  return (
    <div role="status" aria-live="polite" className={styles.trash}>
      {trash.failure === null ? (
        <>
          <span className={styles.trashText}>deleted · {trash.title}</span>
          <button
            type="button"
            className={styles.trashUndo}
            disabled={restoring}
            onClick={() => {
              setRestoring(true);
              void onUndo().finally(() => {
                setRestoring(false);
              });
            }}
          >
            undo
          </button>
        </>
      ) : (
        <span className={styles.trashText}>
          {trash.title} was not brought back. {trash.failure}
        </span>
      )}
    </div>
  );
}
