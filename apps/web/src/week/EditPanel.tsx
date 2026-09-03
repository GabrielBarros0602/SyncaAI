import { useState, type KeyboardEvent } from "react";

import { ApiError } from "../api/client";
import type { Task, TaskChanges } from "../api/types";
import { clock, instantAt, parseClock, parseDuration, zonedDay, zonedMinutes } from "../lib/time";
import { changesFrom, isEmpty } from "./changes";
import styles from "./Week.module.css";

interface Props {
  task: Task;
  timezone: string;
  onSave: (changes: TaskChanges) => Promise<void>;
  onCancel: () => void;
}

/**
 * Title, start, duration and tag, on the task that is open.
 *
 * The panel holds all four and sends only the ones that moved — see `changes.ts` for why
 * that is a correctness rule here rather than a nicety.
 *
 * There is no overlap check in this file, deliberately, for the same reason the new-task
 * form has none: the client knows one week, the exclusion constraint knows everything, and a
 * task moved into a neighbouring week would pass a local check and be refused anyway. The
 * 409 is the authority and its sentence is what shows.
 */
export function EditPanel({ task, timezone, onSave, onCancel }: Props): React.ReactNode {
  const [fields, setFields] = useState({
    title: task.title,
    start: clock(zonedMinutes(task.start_at, timezone)),
    duration: String(task.duration_minutes),
    tag: task.tag?.name ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set(patch: Partial<typeof fields>): void {
    setFields((current) => ({ ...current, ...patch }));
    setError(null);
  }

  function save(): void {
    const title = fields.title.trim();
    if (title === "") {
      setError("A task needs a title.");
      return;
    }

    const start = parseClock(fields.start);
    if (start === null) {
      setError("Start needs 24-hour time, like 14:30.");
      return;
    }

    const duration = parseDuration(fields.duration);
    if (duration === null) {
      setError("Duration is minutes, from 1 to 1440.");
      return;
    }

    // The day the task already belongs to. Editing the clock moves it inside its own day;
    // moving it to another day is a different verb with its own panel.
    const day = zonedDay(task.start_at, timezone);
    const changes = changesFrom(task, {
      title,
      startAt: instantAt(day, start, timezone).toISOString(),
      durationMinutes: duration,
      tag: fields.tag.trim() === "" ? null : fields.tag,
    });

    if (isEmpty(changes)) {
      onCancel();
      return;
    }

    setSaving(true);
    onSave(changes)
      .catch((problem: unknown) => {
        // The panel stays open holding what was typed. Closing it here would throw away an
        // edit over a rule the person can still satisfy by moving the task an hour.
        setError(problem instanceof ApiError ? problem.detail : "Couldn’t reach the server.");
      })
      .finally(() => {
        setSaving(false);
      });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    } else if (event.key === "Escape") {
      onCancel();
    }
  }

  return (
    <div className={styles.panelForm}>
      <div className={styles.panelLabel}>Edit</div>
      <input
        className={styles.input}
        value={fields.title}
        onChange={(event) => {
          set({ title: event.target.value });
        }}
        onKeyDown={onKeyDown}
        placeholder="Title"
        aria-label="Title"
      />
      <div className={styles.pair}>
        <input
          className={styles.inputMono}
          value={fields.start}
          onChange={(event) => {
            set({ start: event.target.value });
          }}
          onKeyDown={onKeyDown}
          placeholder="09:00"
          aria-label="Start"
        />
        <input
          className={styles.inputMono}
          value={fields.duration}
          onChange={(event) => {
            set({ duration: event.target.value });
          }}
          onKeyDown={onKeyDown}
          placeholder="90"
          aria-label="Duration in minutes"
        />
      </div>
      <input
        className={styles.input}
        value={fields.tag}
        onChange={(event) => {
          set({ tag: event.target.value });
        }}
        onKeyDown={onKeyDown}
        placeholder="Tag, optional"
        aria-label="Tag"
      />
      {error !== null && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.submit} disabled={saving} onClick={save}>
          <span>save</span>
          <span className={styles.submitKey}>⏎</span>
        </button>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          <span>cancel</span>
        </button>
      </div>
    </div>
  );
}
