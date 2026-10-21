import { useState } from "react";

import { ApiError } from "../api/client";
import styles from "./Week.module.css";

interface Props {
  /** Why this task cannot be put back, in a sentence, or null to say only that it cannot. */
  reason?: string | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/**
 * Asking before a delete that cannot be undone.
 *
 * Inside the row, not a modal and not the browser's confirm: the question is about this row,
 * and a dialog over the whole week would take the row out of sight while asking about it.
 *
 * It does not ask "are you sure". Somebody who pressed delete is; what they may not know is
 * that this one does not come back, so that is what it says. Nothing here promises a return,
 * because there is no trash and no undo for it (ADR-0011, ADR-0025).
 */
export function DeletePanel({ reason = null, onConfirm, onCancel }: Props): React.ReactNode {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function confirm(): void {
    setError(null);
    setDeleting(true);
    onConfirm()
      .catch((problem: unknown) => {
        setError(problem instanceof ApiError ? problem.detail : "Couldn’t reach the server.");
      })
      .finally(() => {
        setDeleting(false);
      });
  }

  return (
    <div className={styles.panelForm}>
      <div className={styles.panelLabel}>Delete</div>
      <p className={styles.panelNote}>
        {reason === null ? "" : `${reason} `}Deleting removes it and its checklist for good. There
        is no undo for this one.
      </p>
      {error !== null && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.danger} disabled={deleting} onClick={confirm}>
          <span>{deleting ? "deleting…" : "delete for good"}</span>
        </button>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          <span>keep it</span>
        </button>
      </div>
    </div>
  );
}
