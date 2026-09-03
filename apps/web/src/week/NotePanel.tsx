import { useState, type KeyboardEvent } from "react";

import { ApiError } from "../api/client";
import type { Task, TaskChanges } from "../api/types";
import styles from "./Week.module.css";

/** Kept in step with `MAX_NOTES_LENGTH` in the API's task schema. */
const MAX_NOTES = 4000;

interface Props {
  task: Task;
  onSave: (changes: TaskChanges) => Promise<void>;
  onCancel: () => void;
}

/**
 * Free text on a task, and nothing is parsed out of it.
 *
 * Emptying the box clears the note rather than storing an empty string: `null` is what the
 * API reads as "remove this", and the two are otherwise indistinguishable to everything
 * downstream — including the `note` mark on the resting row.
 *
 * The counter only appears near the bound. A note is a place to think out loud, and a
 * character count standing over it from the first keystroke changes what it feels like to
 * use; it earns its place only once it is about to matter.
 */
export function NotePanel({ task, onSave, onCancel }: Props): React.ReactNode {
  const [value, setValue] = useState(task.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const remaining = MAX_NOTES - value.length;

  function save(): void {
    const trimmed = value.trim();
    if (trimmed.length > MAX_NOTES) {
      setError(`A note is at most ${String(MAX_NOTES)} characters.`);
      return;
    }

    setSaving(true);
    onSave({ notes: trimmed === "" ? null : trimmed })
      .catch((problem: unknown) => {
        setError(problem instanceof ApiError ? problem.detail : "Couldn’t reach the server.");
      })
      .finally(() => {
        setSaving(false);
      });
  }

  function onKeyDown(event: KeyboardEvent): void {
    // Enter belongs to the text here, unlike every other field on this screen. A note is the
    // one place somebody writes more than one line, and stealing Enter to save would make
    // paragraphs impossible.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    } else if (event.key === "Escape") {
      onCancel();
    }
  }

  return (
    <div className={styles.panelForm}>
      <div className={styles.panelLabel}>Note</div>
      <textarea
        className={styles.textarea}
        rows={4}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        placeholder="Free text. Nothing is parsed out of it."
        aria-label="Note"
      />
      {remaining <= 200 && (
        <div className={styles.panelCount}>
          {remaining >= 0
            ? `${String(remaining)} characters left`
            : `${String(-remaining)} over the limit`}
        </div>
      )}
      {error !== null && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.submit} disabled={saving} onClick={save}>
          <span>save</span>
          <span className={styles.submitKey}>⌘⏎</span>
        </button>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          <span>cancel</span>
        </button>
      </div>
    </div>
  );
}
