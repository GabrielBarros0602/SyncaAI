/**
 * One step of the plan under review, as plan.dc.html draws it: a row like a task's.
 *
 * At rest it shows its number, its time or why it has none, its length, what it waits on, its
 * description and its links, and no verbs. Pressed, it opens on Edit (or "Give it a time" for
 * a step with no time ahead of it) and Remove; Edit opens the form in place.
 *
 * The form takes a step's fields the way a task's edit takes them, since a step becomes a task
 * and its minutes are a task's (ADR-0032): the duration as `2h30`, the start as a day and a
 * 24-hour time. There is no overlap check here, as there is none in a task's: the server knows
 * every task and every other step, and its sentence is what shows.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";

import { ApiError } from "../api/client";
import type { Plan, PlanItem, PlanItemChanges } from "../api/types";
import { cx } from "../lib/cx";
import {
  clock,
  formatCompact,
  instantAt,
  parseClock,
  parseDuration,
  zonedDay,
  zonedMinutes,
} from "../lib/time";
import { nextWeekStarts, stepDays } from "./editing";
import styles from "./Plan.module.css";
import { afterText, hostOf, shortDate, stepWhen } from "./steps";

/** Kept in step with the API's title bound (ADR-0030). */
const MAX_TITLE = 200;

interface Props {
  item: PlanItem;
  plan: Plan;
  number: number;
  numbers: Map<string, number>;
  timezone: string;
  daysOff: readonly number[];
  /** The server's reason, when a commit was refused for this step. */
  refused: string | null;
  /** Where the router puts focus on arrival. */
  focus: boolean;
  open: boolean;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (changes: PlanItemChanges) => Promise<void>;
  onRemove: () => void;
}

export function StepRow({
  item,
  plan,
  number,
  numbers,
  timezone,
  daysOff,
  refused,
  focus,
  open,
  editing,
  onToggle,
  onEdit,
  onCancelEdit,
  onSave,
  onRemove,
}: Props): React.ReactNode {
  const after = afterText(item, numbers);
  const edit = useRef<HTMLButtonElement>(null);
  // Into the verbs when the row opens, so the next key acts on this step.
  const opened = useRef(open);
  useEffect(() => {
    if (open && !opened.current) edit.current?.focus();
    opened.current = open;
  }, [open]);

  return (
    <li className={cx(styles.step, open && styles.stepOpen, refused !== null && styles.stepRefused)}>
      <button
        type="button"
        id={`step-${item.id}`}
        className={styles.stepToggle}
        aria-expanded={open}
        data-route-focus={focus ? "" : undefined}
        onClick={onToggle}
      >
        <span className={styles.stepMeta}>
          <span>Step {number}</span>
          <span>{stepWhen(item, timezone)}</span>
          <span>{formatCompact(item.minutes)}</span>
        </span>
        <span className={styles.stepTitle}>{item.title}</span>
        {after !== null && <span className={styles.stepNote}>{after}</span>}
        {item.description !== "" && <span className={styles.stepNote}>{item.description}</span>}
        {refused !== null ? (
          <span className={styles.stepError}>{refused}</span>
        ) : (
          item.reason !== null && <span className={styles.reason}>{item.reason}</span>
        )}
      </button>
      {item.links.length > 0 && (
        <ul aria-label="Links" className={styles.links}>
          {item.links.map((link) => (
            <li key={link.url}>
              <a href={link.url} target="_blank" rel="noopener noreferrer" className={styles.link}>
                <span>{link.label}</span>
                <span className={styles.host}>{hostOf(link.url)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className={styles.stepPanel}>
          {editing ? (
            <StepEdit
              item={item}
              plan={plan}
              timezone={timezone}
              daysOff={daysOff}
              onSave={onSave}
              onCancel={onCancelEdit}
            />
          ) : (
            <div className={styles.actions}>
              <button ref={edit} type="button" className={styles.button} onClick={onEdit}>
                {item.start_at === null || item.state === "passed" ? "Give it a time" : "Edit"}
              </button>
              <button type="button" className={styles.button} onClick={onRemove}>
                Remove
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

interface EditProps {
  item: PlanItem;
  plan: Plan;
  timezone: string;
  daysOff: readonly number[];
  onSave: (changes: PlanItemChanges) => Promise<void>;
  onCancel: () => void;
}

/** Title, start and duration of one step, sending only what moved. */
function StepEdit({ item, plan, timezone, daysOff, onSave, onCancel }: EditProps): React.ReactNode {
  const id = useId();
  const now = new Date();
  const today = zonedDay(now.toISOString(), timezone);
  const days = stepDays(plan, today, daysOff);
  // A step with a time ahead of it keeps it; one without starts on the day it would most
  // likely go, the first after this week for one waiting for next week, and a time to type.
  const placed = item.start_at !== null && item.state !== "passed" ? item.start_at : null;
  const waiting = nextWeekStarts(plan);
  const firstDay =
    placed !== null
      ? zonedDay(placed, timezone)
      : item.state === "not_this_week" && days.some((option) => option.day === waiting)
        ? waiting
        : (days[0]?.day ?? today);
  const [fields, setFields] = useState({
    title: item.title,
    day: firstDay,
    time: placed === null ? "" : clock(zonedMinutes(placed, timezone)),
    duration: formatCompact(item.minutes),
  });
  const [tried, setTried] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const first = useRef<Record<"title" | "time" | "duration", HTMLInputElement | null>>({
    title: null,
    time: null,
    duration: null,
  });

  useEffect(() => {
    first.current.title?.focus();
  }, []);

  const title = fields.title.trim();
  const start = parseClock(fields.time);
  const duration = parseDuration(fields.duration);
  const problems = {
    title: title === "" ? "A step needs a title." : null,
    time: start === null ? "Use 24-hour time, like 14:30." : null,
    duration: duration === null ? "Between 1m and 24h, like 2h30." : null,
  };
  const shown = (problem: string | null): string | null => (tried ? problem : null);
  const dayOff = days.find((option) => option.day === fields.day)?.off === true;
  // The rules the server holds for a step (ADR-0030), said before it has to refuse anything.
  const hint = `Not before now: ${clock(zonedMinutes(now.toISOString(), timezone))} today, and clear of your tasks and the plan’s other steps.${dayOff ? ` ${shortDate(fields.day)} is a day off.` : ""}`;

  function set(patch: Partial<typeof fields>): void {
    setFields((current) => ({ ...current, ...patch }));
    setRefusal(null);
  }

  function save(event: SyntheticEvent): void {
    event.preventDefault();
    if (saving) return;
    setTried(true);
    if (start === null || duration === null || problems.title !== null) {
      const field = problems.title !== null ? "title" : problems.time !== null ? "time" : "duration";
      first.current[field]?.focus();
      return;
    }
    const startAt = instantAt(fields.day, start, timezone).toISOString();
    // Only what moved: a start sent unchanged is checked against the past again (ADR-0030).
    const changes: PlanItemChanges = {
      ...(title === item.title ? {} : { title }),
      ...(duration === item.minutes ? {} : { minutes: duration }),
      ...(placed !== null && Date.parse(placed) === Date.parse(startAt) ? {} : { start_at: startAt }),
    };
    if (Object.keys(changes).length === 0) {
      onCancel();
      return;
    }
    setSaving(true);
    onSave(changes).catch((problem: unknown) => {
      // The form stays, holding what was typed: the refusal is about the start, most often,
      // and an hour later may be all it takes.
      setRefusal(problem instanceof ApiError ? problem.detail : "Couldn’t reach the server.");
      setSaving(false);
      first.current.time?.focus();
    });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") onCancel();
  }

  return (
    <form className={styles.form} aria-label="Edit step" aria-busy={saving} noValidate onSubmit={save}>
      <div className={styles.field}>
        <label htmlFor={`${id}-title`} className={styles.label}>
          Title
        </label>
        <input
          id={`${id}-title`}
          ref={(element) => {
            first.current.title = element;
          }}
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

      <fieldset className={styles.start}>
        <legend className={styles.label}>Start</legend>
        <div className={styles.startDay}>
          <label htmlFor={`${id}-day`} className={styles.quiet}>
            Day
          </label>
          <select
            id={`${id}-day`}
            className={styles.select}
            value={fields.day}
            aria-describedby={`${id}-hint ${id}-refusal`}
            onChange={(event) => {
              set({ day: event.target.value });
            }}
            onKeyDown={onKeyDown}
          >
            {days.map((option) => (
              <option key={option.day} value={option.day}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.startTime}>
          <label htmlFor={`${id}-time`} className={styles.quiet}>
            Time
          </label>
          <input
            id={`${id}-time`}
            ref={(element) => {
              first.current.time = element;
            }}
            className={cx(styles.input, styles.mono, (shown(problems.time) !== null || refusal !== null) && styles.fieldBad)}
            inputMode="numeric"
            value={fields.time}
            aria-invalid={shown(problems.time) !== null || refusal !== null}
            aria-describedby={`${id}-hint ${id}-time-error ${id}-refusal`}
            onChange={(event) => {
              set({ time: event.target.value });
            }}
            onKeyDown={onKeyDown}
          />
          <span id={`${id}-time-error`} className={styles.fieldError}>
            {shown(problems.time)}
          </span>
        </div>
        <p id={`${id}-hint`} className={cx(styles.quiet, styles.startWide)}>
          {hint}
        </p>
        <p id={`${id}-refusal`} role="alert" className={cx(styles.fieldError, styles.startWide)}>
          {refusal}
        </p>
      </fieldset>

      <div className={styles.field}>
        <label htmlFor={`${id}-duration`} className={styles.label}>
          Duration
        </label>
        <input
          id={`${id}-duration`}
          ref={(element) => {
            first.current.duration = element;
          }}
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

      <div className={styles.actions}>
        <button type="submit" className={styles.primary} aria-busy={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className={styles.button} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
