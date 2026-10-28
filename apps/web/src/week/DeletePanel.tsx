import { useId, useState } from "react";

import { ApiError } from "../api/client";
import day from "./Day.module.css";

interface Props {
  /** Each reason this task cannot be put back, as a sentence. */
  reasons: string[];
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/**
 * Asking before a delete that cannot be undone (item 21 of the round).
 *
 * Inside the row, not a modal and not the browser's confirm: the question is about this row,
 * and a dialog over the whole week would take the row out of sight while asking about it.
 *
 * It does not ask "are you sure". Somebody who pressed delete is; what they may not know is
 * that this one does not come back, and why, so that is what it says. Nothing here promises a
 * return, because there is no trash and no undo for it (ADR-0011, ADR-0025).
 */
export function DeletePanel({ reasons, onConfirm, onCancel }: Props): React.ReactNode {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const heading = useId();

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
    <div role="group" aria-labelledby={heading} className={day.panel}>
      <span id={heading} className={day.panelHead}>
        No undo for this one
      </span>
      <ul className={day.reasons}>
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <span className={day.panelHint}>
        Undo recreates a task from scratch, so it can only bring back one that hasn’t started,
        isn’t done and has nothing ticked. Deleting removes this task and its checklist for good.
      </span>
      {error !== null && (
        <span role="alert" className={day.refusal}>
          {error}
        </span>
      )}
      <div className={day.actions}>
        <button type="button" className={day.danger} disabled={deleting} onClick={confirm}>
          {deleting ? "deleting…" : "delete for good"}
        </button>
        <button type="button" className={day.secondary} onClick={onCancel}>
          keep it
        </button>
      </div>
    </div>
  );
}
