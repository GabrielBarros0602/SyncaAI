import { useId, useState, type KeyboardEvent, type SyntheticEvent } from "react";

import { ApiError } from "../api/client";
import type { Task, TaskChanges } from "../api/types";
import day from "./Day.module.css";

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
 * The count stands beside the label from the first character, as the round draws it, and the
 * field stops at the bound rather than letting somebody type past what the server keeps.
 */
export function NotePanel({ task, onSave, onCancel }: Props): React.ReactNode {
  const [value, setValue] = useState(task.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const field = useId();

  function save(event?: SyntheticEvent): void {
    event?.preventDefault();
    const trimmed = value.trim();
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
    // paragraphs impossible. The modifier saves.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      save(event);
    } else if (event.key === "Escape") {
      onCancel();
    }
  }

  return (
    <form className={day.panel} onSubmit={save}>
      <div className={day.fieldHead}>
        <label htmlFor={field} className={day.panelHead}>
          Note
        </label>
        <span className={day.count}>
          {value.length}/{MAX_NOTES}
        </span>
      </div>
      <textarea
        id={field}
        className={day.textarea}
        rows={5}
        maxLength={MAX_NOTES}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
      />
      {error !== null && (
        <span role="alert" className={day.refusal}>
          {error}
        </span>
      )}
      <div className={day.actions}>
        <button type="submit" className={day.primary} disabled={saving}>
          save note
        </button>
        <button type="button" className={day.secondary} onClick={onCancel}>
          cancel
        </button>
      </div>
    </form>
  );
}
