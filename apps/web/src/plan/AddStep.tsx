/**
 * A step added to the plan by hand (plan.dc.html, ADR-0047).
 *
 * No time: the server places it where placing the plan again would, at the first free time,
 * and the person moves it after if they want. Its length starts at their preferred block, which
 * is how long a step the planner proposes may be, and can be anything a task can (ADR-0032).
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";

import { ApiError } from "../api/client";
import type { NewPlanItem } from "../api/types";
import { cx } from "../lib/cx";
import { formatCompact, parseDuration } from "../lib/time";
import styles from "./Plan.module.css";

/** Kept in step with the API's bounds (ADR-0030). */
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 500;

interface Props {
  /** The person's preferred block, in minutes. */
  blockMinutes: number;
  /**
   * Whatever above the form the step needs first, checked when it is sent: false when it is
   * missing, having said so and taken focus there, as the first field wrong on the page.
   */
  ready?: (() => boolean) | undefined;
  onAdd: (step: NewPlanItem) => Promise<void>;
  onCancel: () => void;
}

export function AddStep({ blockMinutes, ready, onAdd, onCancel }: Props): React.ReactNode {
  const id = useId();
  const [fields, setFields] = useState({ title: "", duration: formatCompact(blockMinutes), description: "" });
  const [tried, setTried] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const titleField = useRef<HTMLInputElement>(null);
  const durationField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleField.current?.focus();
  }, []);

  const title = fields.title.trim();
  const duration = parseDuration(fields.duration);
  const problems = {
    title: title === "" ? "A step needs a title." : null,
    duration: duration === null ? "Between 1m and 24h, like 2h30." : null,
  };
  const shown = (problem: string | null): string | null => (tried ? problem : null);

  function set(patch: Partial<typeof fields>): void {
    setFields((current) => ({ ...current, ...patch }));
    setRefusal(null);
  }

  function add(event: SyntheticEvent): void {
    event.preventDefault();
    if (adding) return;
    setTried(true);
    const above = ready?.() ?? true;
    if (problems.title !== null || duration === null) {
      if (above) (problems.title !== null ? titleField : durationField).current?.focus();
      return;
    }
    if (!above) return;
    setAdding(true);
    onAdd({ title, minutes: duration, description: fields.description.trim() }).catch((problem: unknown) => {
      setRefusal(problem instanceof ApiError ? problem.detail : "Couldn’t reach the server.");
      setAdding(false);
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") onCancel();
  }

  return (
    <form className={cx(styles.form, styles.adding)} aria-labelledby={`${id}-heading`} aria-busy={adding} noValidate onSubmit={add}>
      <strong id={`${id}-heading`}>New step</strong>
      <div className={styles.field}>
        <label htmlFor={`${id}-title`} className={styles.label}>
          Title
        </label>
        <input
          ref={titleField}
          id={`${id}-title`}
          className={cx(styles.input, shown(problems.title) !== null && styles.fieldBad)}
          maxLength={MAX_TITLE}
          value={fields.title}
          aria-invalid={shown(problems.title) !== null}
          aria-describedby={`${id}-title-error`}
          onChange={(event) => {
            set({ title: event.target.value });
          }}
          onKeyDown={onKeyDown}
        />
        <span id={`${id}-title-error`} className={styles.fieldError}>
          {shown(problems.title)}
        </span>
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-duration`} className={styles.label}>
          Duration
        </label>
        <input
          ref={durationField}
          id={`${id}-duration`}
          className={cx(styles.input, styles.mono, styles.short, shown(problems.duration) !== null && styles.fieldBad)}
          value={fields.duration}
          aria-invalid={shown(problems.duration) !== null}
          aria-describedby={`${id}-duration-hint ${id}-duration-error`}
          onChange={(event) => {
            set({ duration: event.target.value });
          }}
          onKeyDown={onKeyDown}
        />
        <span id={`${id}-duration-hint`} className={styles.quiet}>
          From 1m to 24h, like 2h30.
        </span>
        <span id={`${id}-duration-error`} className={styles.fieldError}>
          {shown(problems.duration)}
        </span>
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-description`} className={styles.label}>
          Description <span className={styles.optional}>(optional)</span>
        </label>
        <textarea
          id={`${id}-description`}
          className={cx(styles.textarea, styles.textareaShort)}
          rows={2}
          maxLength={MAX_DESCRIPTION}
          value={fields.description}
          onChange={(event) => {
            set({ description: event.target.value });
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <p className={styles.quiet}>It goes to the first free time; you can move it after.</p>
      {refusal !== null && (
        <p role="alert" className={styles.fieldError}>
          {refusal}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} aria-busy={adding}>
          {adding ? "Adding…" : "Add"}
        </button>
        <button type="button" className={styles.button} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
