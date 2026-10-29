import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";

import { ApiError } from "../api/client";
import type { DayCapacity, NewTask } from "../api/types";
import {
  clock,
  dayMonth,
  instantAt,
  parseClock,
  parseDuration,
  weekdayName,
  weekdayOf,
  zonedDay,
  zonedMinutes,
} from "../lib/time";
import { cx } from "../lib/cx";
import { normaliseTag } from "./changes";
import { TagField, tagStatus, useTags } from "./TagField";
import day from "./Day.module.css";

/** Kept in step with the API's title bound. */
const MAX_TITLE = 200;

interface Props {
  /** The day it opened on: the focused day, or the one whose "+ new task" was pressed. */
  startDay: string;
  /** The week on screen: the days a task can be put on from here. */
  days: DayCapacity[];
  timezone: string;
  /** Create it; `sentence` is what the status region says once it is in. Rejects on refusal. */
  onCreate: (task: NewTask, sentence: string) => Promise<void>;
  /** Closed without creating: Esc, cancel, or the backdrop. */
  onClose: () => void;
}

/** The next half hour after now, in the person's zone, as a clock; 09:00 on any other day. */
function firstTime(localDate: string, timezone: string, now: Date): string {
  if (localDate !== zonedDay(now.toISOString(), timezone)) return "09:00";
  const next = Math.ceil((zonedMinutes(now.toISOString(), timezone) + 1) / 30) * 30;
  return clock(Math.min(next, 23 * 60 + 30));
}

/**
 * A new task, in a dialog over the week (the round's create flow).
 *
 * A dialog rather than a form inside the day: the round gives a new task a title, a day, a
 * time, a length, a tag and a checklist, which a 155px column cannot hold, and the day stays a
 * choice inside it rather than being fixed by where it was opened. Native `<dialog>`, as the
 * Menu is: the browser keeps focus inside, makes the week behind it inert and closes it on Esc.
 *
 * There is no overlap check here, deliberately. The client knows one week, the exclusion
 * constraint knows everything, and a task in a neighbouring week would pass a local check and
 * be refused anyway. The server's sentence shows at the time, which is what it is about.
 */
export function NewTaskDialog({ startDay, days, timezone, onCreate, onClose }: Props): React.ReactNode {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  // Where focus goes back to when it closes without creating: the button or the cell it was
  // opened from, so the keyboard lands where it left.
  const opener = useRef<Element | null>(null);
  const tags = useTags();
  const [fields, setFields] = useState(() => ({
    title: "",
    day: startDay,
    time: firstTime(startDay, timezone, new Date()),
    duration: "1h",
    tag: "",
  }));
  const [items, setItems] = useState<string[]>([]);
  const [item, setItem] = useState("");
  const [tried, setTried] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputs = useRef<Record<"title" | "time" | "duration", HTMLInputElement | null>>({
    title: null,
    time: null,
    duration: null,
  });

  useEffect(() => {
    opener.current = document.activeElement;
    dialog.current?.showModal();
    inputs.current.title?.focus();
  }, []);

  const title = fields.title.trim();
  const start = parseClock(fields.time);
  const duration = parseDuration(fields.duration);
  const problems = {
    title: title === "" ? "A task needs a title." : null,
    time: start === null ? "Use 24-hour time, like 14:30." : null,
    duration: duration === null ? "Between 1m and 24h, like 2h30." : null,
  };
  const shown = (problem: string | null): string | null => (tried ? problem : null);

  const now = new Date();
  const today = zonedDay(now.toISOString(), timezone);
  const at = clock(zonedMinutes(now.toISOString(), timezone));
  const timeHint =
    fields.day < today
      ? `This day has passed. A task can start at ${at} today or later.`
      : fields.day === today
        ? `Not before ${at} today. 24-hour time, ${timezone}.`
        : `24-hour time, ${timezone}.`;
  const startAt = start === null ? null : instantAt(fields.day, start, timezone);
  const ends =
    startAt === null || duration === null
      ? null
      : new Date(startAt.getTime() + duration * 60_000).toISOString();
  const durationHint =
    ends === null
      ? "1m to 24h, like 45m or 2h30."
      : `Ends ${weekdayOf(zonedDay(ends, timezone))} ${clock(zonedMinutes(ends, timezone))}.`;
  const { isNew } = tagStatus(fields.tag, tags);
  const tag = normaliseTag(fields.tag);
  const timeError = refusal ?? shown(problems.time);

  function set(patch: Partial<typeof fields>): void {
    setFields((current) => ({ ...current, ...patch }));
    if ("day" in patch || "time" in patch) setRefusal(null);
  }

  function cancel(): void {
    dialog.current?.close();
  }

  function addItem(): void {
    const label = item.trim();
    if (label === "") return;
    setItems((current) => [...current, label]);
    setItem("");
  }

  function save(event: SyntheticEvent): void {
    event.preventDefault();
    if (saving) return;
    setTried(true);
    if (startAt === null || duration === null || problems.title !== null) {
      const field = problems.title !== null ? "title" : problems.time !== null ? "time" : "duration";
      inputs.current[field]?.focus();
      return;
    }

    const where = `${weekdayOf(fields.day)} ${String(Number(fields.day.slice(8, 10)))}, ${clock(start ?? 0)}`;
    setSaving(true);
    setRefusal(null);
    onCreate(
      {
        title,
        start_at: startAt.toISOString(),
        duration_minutes: duration,
        ...(tag === null ? {} : { tag }),
        ...(items.length === 0 ? {} : { items: items.map((label) => ({ label })) }),
      },
      `Added “${title}” to ${where}.${isNew && tag !== null ? ` Created the tag “${tag}”.` : ""}`,
    ).catch((problem: unknown) => {
      // Kept open with everything typed: a refusal is about the time, and moving it an hour
      // is how it is answered.
      setSaving(false);
      setRefusal(problem instanceof ApiError ? problem.detail : "Couldn’t reach the server.");
      inputs.current.time?.focus();
    });
  }

  return (
    // The click handler closes on a click on the backdrop, the dialog itself rather than
    // anything in it: a pointer's shortcut for cancel, which the keyboard has as Esc.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialog}
      className={day.dialog}
      aria-labelledby={`${id}-heading`}
      onClose={() => {
        onClose();
        if (opener.current instanceof HTMLElement) opener.current.focus();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <div className={day.dialogHead}>
        <h2 id={`${id}-heading`} className={day.dialogTitle}>
          New task
        </h2>
        <span className={day.dialogKey}>Esc closes</span>
      </div>
      <form className={day.form} noValidate aria-busy={saving} onSubmit={save}>
        <div className={day.field}>
          <label htmlFor={`${id}-title`} className={day.panelHead}>
            Title
          </label>
          <input
            id={`${id}-title`}
            ref={(element) => {
              inputs.current.title = element;
            }}
            className={cx(day.input, shown(problems.title) !== null && day.inputBad)}
            maxLength={MAX_TITLE}
            value={fields.title}
            aria-invalid={shown(problems.title) !== null}
            aria-describedby={`${id}-title-error`}
            onChange={(event) => {
              set({ title: event.target.value });
            }}
          />
          <div className={day.fieldHead}>
            <span id={`${id}-title-error`} className={day.fieldError}>
              {shown(problems.title)}
            </span>
            <span className={day.count}>
              {fields.title.length}/{MAX_TITLE}
            </span>
          </div>
        </div>

        <fieldset className={day.fieldset}>
          <legend className={day.panelHead}>Start</legend>
          <div className={day.pair}>
            <div className={day.field}>
              <label htmlFor={`${id}-day`} className={day.panelHint}>
                Day
              </label>
              <select
                id={`${id}-day`}
                className={day.select}
                value={fields.day}
                aria-describedby={`${id}-time-hint ${id}-time-error`}
                onChange={(event) => {
                  set({ day: event.target.value });
                }}
              >
                {days.map((option) => {
                  const [year = 1970, month = 1, date = 1] = option.day.split("-").map(Number);
                  const label = `${weekdayName(option.weekday)} ${dayMonth(new Date(year, month - 1, date))}`;
                  const when = option.day < today ? " (past)" : option.day === today ? " (today)" : "";
                  return (
                    <option key={option.day} value={option.day}>
                      {label}
                      {when}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className={day.field}>
              <label htmlFor={`${id}-time`} className={day.panelHint}>
                Time
              </label>
              <input
                id={`${id}-time`}
                ref={(element) => {
                  inputs.current.time = element;
                }}
                className={cx(day.input, day.mono, timeError !== null && day.inputBad)}
                inputMode="numeric"
                value={fields.time}
                aria-invalid={timeError !== null}
                aria-describedby={`${id}-time-hint ${id}-time-error`}
                onChange={(event) => {
                  set({ time: event.target.value });
                }}
              />
            </div>
          </div>
          <span id={`${id}-time-hint`} className={day.panelHint}>
            {timeHint}
          </span>
          {/* The server's refusal is announced; a field's own problem is read with the field. */}
          <span
            id={`${id}-time-error`}
            role={refusal !== null ? "alert" : undefined}
            className={day.fieldError}
          >
            {timeError}
          </span>
        </fieldset>

        <div className={day.field}>
          <label htmlFor={`${id}-duration`} className={day.panelHead}>
            Duration
          </label>
          <input
            id={`${id}-duration`}
            ref={(element) => {
              inputs.current.duration = element;
            }}
            className={cx(day.input, day.mono, shown(problems.duration) !== null && day.inputBad)}
            value={fields.duration}
            aria-invalid={shown(problems.duration) !== null}
            aria-describedby={`${id}-duration-hint ${id}-duration-error`}
            onChange={(event) => {
              set({ duration: event.target.value });
            }}
          />
          <span id={`${id}-duration-hint`} className={day.panelHint}>
            {durationHint}
          </span>
          <span id={`${id}-duration-error`} className={day.fieldError}>
            {shown(problems.duration)}
          </span>
        </div>

        <TagField
          value={fields.tag}
          tags={tags}
          onChange={(value) => {
            set({ tag: value });
          }}
          onEscape={cancel}
        />

        <div role="group" aria-labelledby={`${id}-list`} className={day.field}>
          <span id={`${id}-list`} className={day.panelHead}>
            Checklist <span className={day.quiet}>(optional)</span>
          </span>
          {items.length > 0 && (
            <ul className={day.items}>
              {items.map((label, position) => (
                <li key={`${String(position)}:${label}`} className={day.itemRow}>
                  <span>{label}</span>
                  <button
                    type="button"
                    className={day.close}
                    aria-label={`Remove “${label}”`}
                    onClick={() => {
                      setItems((current) => current.filter((_, at) => at !== position));
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label htmlFor={`${id}-item`} className={day.panelHint}>
            New item
          </label>
          <div className={day.addRow}>
            <input
              id={`${id}-item`}
              className={day.input}
              maxLength={MAX_TITLE}
              value={item}
              onChange={(event) => {
                setItem(event.target.value);
              }}
              onKeyDown={(event) => {
                // Enter adds the item rather than saving the task half written.
                if (event.key === "Enter") {
                  event.preventDefault();
                  addItem();
                }
              }}
            />
            <button type="button" className={day.secondary} onClick={addItem}>
              add
            </button>
          </div>
        </div>

        <div className={day.actions}>
          <button type="submit" className={day.primary} aria-busy={saving}>
            {saving ? "saving…" : isNew && tag !== null ? `save and create tag “${tag}”` : "save"}
          </button>
          <button type="button" className={day.secondary} onClick={cancel}>
            cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
