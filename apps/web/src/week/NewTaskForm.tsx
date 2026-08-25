import { useState, type KeyboardEvent } from "react";

import { parseClock, parseDuration } from "../lib/time";
import type { NewTask } from "../api/types";
import styles from "./Week.module.css";

interface Props {
  weekday: string;
  date: string;
  /** The local day this task starts on, `YYYY-MM-DD`. */
  day: string;
  /** The IANA zone the server stores, so the offset written here is the user's, not this
   * browser's — the two can differ and the difference is silent. */
  timezone: string;
  submitting: boolean;
  /** Set from the server's answer. A conflict is a 409, and the message is the API's. */
  serverError: string | null;
  onSubmit: (task: NewTask) => void;
  onCancel: () => void;
}

const EMPTY = { title: "", start: "", duration: "", tag: "" };

/**
 * Build an ISO timestamp for a local day and time in a named zone.
 *
 * The offset is asked of `Intl` for that exact instant rather than assumed, because an
 * offset is not a property of a zone — it is a property of a zone at a moment, and it moves
 * twice a year in every zone that still observes daylight saving.
 */
function toIsoInZone(day: string, minutesFromMidnight: number, timeZone: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const hours = Math.floor(minutesFromMidnight / 60);
  const minutes = minutesFromMidnight % 60;
  const guess = Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1, hours, minutes);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(guess));

  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const asZoned = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour") % 24,
    read("minute"),
    read("second"),
  );

  return new Date(guess + (guess - asZoned)).toISOString();
}

export function NewTaskForm({
  weekday,
  date,
  day,
  timezone,
  submitting,
  serverError,
  onSubmit,
  onCancel,
}: Props): React.ReactNode {
  const [fields, setFields] = useState(EMPTY);
  const [items, setItems] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  const error = localError ?? serverError;

  function set(patch: Partial<typeof EMPTY>): void {
    setFields((current) => ({ ...current, ...patch }));
    setLocalError(null);
  }

  function submit(): void {
    const title = fields.title.trim();
    if (title === "") {
      setLocalError("A task needs a title.");
      return;
    }

    const start = parseClock(fields.start);
    if (start === null) {
      setLocalError("Start needs 24-hour time, like 14:30.");
      return;
    }

    const duration = parseDuration(fields.duration);
    if (duration === null) {
      setLocalError("Duration is minutes, from 1 to 1440.");
      return;
    }

    // No overlap check here, deliberately. The design's mock had one, and a client cannot
    // hold that rule: it only knows the week on screen, so a task in an adjacent week would
    // pass and then be refused. The database owns it through an exclusion constraint, and
    // the 409 it answers with is what this form shows.
    const tag = fields.tag.trim();
    onSubmit({
      title,
      start_at: toIsoInZone(day, start, timezone),
      duration_minutes: duration,
      ...(tag === "" ? {} : { tag }),
      ...(items.length === 0
        ? {}
        : { items: items.filter((label) => label.trim() !== "").map((label) => ({ label })) }),
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      onCancel();
    }
  }

  return (
    <div className={styles.form}>
      <div className={styles.formHead}>
        <span className={styles.formTitle}>New task</span>
        <span className={styles.formWhen}>
          {weekday} {date}
        </span>
      </div>
      <input
        className={styles.input}
        value={fields.title}
        onChange={(event) => {
          set({ title: event.target.value });
        }}
        onKeyDown={onKeyDown}
        placeholder="Title"
        aria-label="Title"
        autoFocus
      />
      <div className={styles.pair}>
        <input
          className={styles.inputMono}
          value={fields.start}
          onChange={(event) => {
            set({ start: event.target.value });
          }}
          onKeyDown={onKeyDown}
          placeholder="start 09:00"
          aria-label="Start time"
        />
        <input
          className={styles.inputMono}
          value={fields.duration}
          onChange={(event) => {
            set({ duration: event.target.value });
          }}
          onKeyDown={onKeyDown}
          placeholder="90 min"
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
      {items.map((label, position) => (
        <div key={position} className={styles.itemRow}>
          <span className={styles.itemBox} aria-hidden="true" />
          <input
            className={styles.itemInput}
            value={label}
            onChange={(event) => {
              const next = [...items];
              next[position] = event.target.value;
              setItems(next);
            }}
            onKeyDown={onKeyDown}
            placeholder="Checklist item"
            aria-label={`Checklist item ${String(position + 1)}`}
          />
        </div>
      ))}
      <button
        type="button"
        className={styles.addItem}
        onClick={() => {
          setItems([...items, ""]);
        }}
      >
        + checklist item
      </button>
      {error !== null && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.submit} onClick={submit} disabled={submitting}>
          <span>{submitting ? "adding…" : "add task"}</span>
          <span className={styles.submitKey}>&#9166;</span>
        </button>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          <span>cancel</span>
          <span className={styles.key}>esc</span>
        </button>
      </div>
    </div>
  );
}
