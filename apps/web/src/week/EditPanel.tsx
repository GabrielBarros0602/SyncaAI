import { useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";

import { ApiError } from "../api/client";
import type { DayCapacity, Task, TaskChanges } from "../api/types";
import {
  clock,
  dayMonth,
  formatCompact,
  instantAt,
  parseClock,
  parseDuration,
  relativeDay,
  weekdayName,
  weekdayOf,
  zonedDay,
  zonedMinutes,
} from "../lib/time";
import { cx } from "../lib/cx";
import { changesFrom, isEmpty, normaliseTag } from "./changes";
import { TagField, tagStatus, useTags } from "./TagField";
import day from "./Day.module.css";

/** Kept in step with the API's title bound. */
const MAX_TITLE = 200;

/** Kept in step with `START_CORRECTION_HOURS` in the API's task service (ADR-0027). */
const START_CORRECTION_HOURS = 24;

interface Props {
  task: Task;
  /** The week on screen: the days a start can be moved to from here. */
  days: DayCapacity[];
  timezone: string;
  onSave: (changes: TaskChanges, sentence?: string) => Promise<void>;
  onCancel: () => void;
}

/** `Mon 26 Oct`, for a local date, without letting the browser's zone move it. */
function dayOption(localDate: string, weekday: number): string {
  const [year = 1970, month = 1, date = 1] = localDate.split("-").map(Number);
  return `${weekdayName(weekday)} ${dayMonth(new Date(year, month - 1, date))}`;
}

/** `Thu 15:30`: an instant as a weekday and a clock in the person's zone. */
function at(instant: Date, timezone: string): string {
  const iso = instant.toISOString();
  return `${weekdayOf(zonedDay(iso, timezone))} ${clock(zonedMinutes(iso, timezone))}`;
}

/**
 * Title, start, duration and tag, on the task that is open (item 25 of the round).
 *
 * It says how far back the start can go before anything is pressed: a task that has begun can
 * be corrected up to a day back (ADR-0027), one that has not cannot start before now. And it
 * sends only the fields that moved — see `changes.ts` for why that is a correctness rule.
 *
 * There is no overlap check in this file, deliberately: the client knows one week, the
 * exclusion constraint knows everything, and a task moved into a neighbouring week would pass a
 * local check and be refused anyway. The 409 is the authority and its sentence is what shows.
 */
export function EditPanel({ task, days, timezone, onSave, onCancel }: Props): React.ReactNode {
  const id = useId();
  const found = useTags();
  // The task's own tag is one of theirs whether or not the list has arrived.
  const tags =
    found === null || task.tag === null ? found : [...new Set([...found, task.tag.name])];
  const [fields, setFields] = useState({
    title: task.title,
    day: zonedDay(task.start_at, timezone),
    time: clock(zonedMinutes(task.start_at, timezone)),
    duration: formatCompact(task.duration_minutes),
    tag: task.tag?.name ?? "",
  });
  // Field errors show once a save was tried, not while somebody is still typing.
  const [tried, setTried] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const first = useRef<Record<"title" | "time" | "duration", HTMLInputElement | null>>({
    title: null,
    time: null,
    duration: null,
  });

  const title = fields.title.trim();
  const start = parseClock(fields.time);
  const duration = parseDuration(fields.duration);
  const problems = {
    title: title === "" ? "A task needs a title." : null,
    time: start === null ? "Use 24-hour time, like 14:30." : null,
    duration: duration === null ? "Between 1m and 24h, like 2h30." : null,
  };

  const now = new Date();
  const today = zonedDay(now.toISOString(), timezone);
  const begun = Date.parse(task.start_at) <= now.getTime();
  // The rule the server holds (ADR-0027), said before it has to refuse anything.
  const earliest = new Date(now.getTime() - START_CORRECTION_HOURS * 3_600_000).toISOString();
  const startHint = begun
    ? `Started ${clock(zonedMinutes(task.start_at, timezone))} ${relativeDay(zonedDay(task.start_at, timezone), today)}. The start can go back to ${clock(zonedMinutes(earliest, timezone))} ${relativeDay(zonedDay(earliest, timezone), today)}, not earlier.`
    : `Not before now: ${clock(zonedMinutes(now.toISOString(), timezone))} today.`;
  const startAt = start === null ? null : instantAt(fields.day, start, timezone);
  const ends =
    startAt === null || duration === null
      ? "—"
      : at(new Date(startAt.getTime() + duration * 60_000), timezone);
  const { isNew } = tagStatus(fields.tag, tags);
  const newTag = normaliseTag(fields.tag) ?? "";

  function set(patch: Partial<typeof fields>): void {
    setFields((current) => ({ ...current, ...patch }));
    setRefusal(null);
  }

  function save(event?: SyntheticEvent): void {
    event?.preventDefault();
    setTried(true);
    if (startAt === null || duration === null || problems.title !== null) {
      // The first field that needs fixing takes focus, so nobody has to hunt for it.
      const field = problems.title !== null ? "title" : problems.time !== null ? "time" : "duration";
      first.current[field]?.focus();
      return;
    }

    const changes = changesFrom(task, {
      title,
      startAt: startAt.toISOString(),
      durationMinutes: duration,
      tag: fields.tag.trim() === "" ? null : fields.tag,
    });
    if (isEmpty(changes)) {
      onCancel();
      return;
    }

    setSaving(true);
    // A tag that did not exist before is worth saying: a typo would otherwise pass unseen.
    onSave(changes, isNew ? `Saved “${title}”, and created the tag “${newTag}”.` : undefined)
      .catch((problem: unknown) => {
        // The panel stays open holding what was typed. Closing it here would throw away an
        // edit over a rule the person can still satisfy by moving the task an hour.
        setRefusal(problem instanceof ApiError ? problem.detail : "Couldn’t reach the server.");
      })
      .finally(() => {
        setSaving(false);
      });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") onCancel();
  }

  const shown = (problem: string | null): string | null => (tried ? problem : null);

  return (
    <form className={day.form} aria-label="Edit task" noValidate onSubmit={save}>
      <div className={day.field}>
        <div className={day.fieldHead}>
          <label htmlFor={`${id}-title`} className={day.panelHead}>
            Title
          </label>
          <span className={day.count}>
            {fields.title.length}/{MAX_TITLE}
          </span>
        </div>
        <input
          id={`${id}-title`}
          ref={(element) => {
            first.current.title = element;
          }}
          className={cx(day.input, shown(problems.title) !== null && day.inputBad)}
          maxLength={MAX_TITLE}
          value={fields.title}
          aria-invalid={shown(problems.title) !== null}
          aria-describedby={`${id}-title-error`}
          onChange={(event) => {
            set({ title: event.target.value });
          }}
          onKeyDown={onKeyDown}
        />
        <span id={`${id}-title-error`} className={day.fieldError}>
          {shown(problems.title)}
        </span>
      </div>

      <div className={day.field}>
        <label htmlFor={`${id}-time`} className={day.panelHead}>
          Start
        </label>
        <div className={day.pair}>
          <select
            className={day.select}
            aria-label="Start day"
            value={fields.day}
            onChange={(event) => {
              set({ day: event.target.value });
            }}
            onKeyDown={onKeyDown}
          >
            {days.map((option) => (
              <option key={option.day} value={option.day}>
                {dayOption(option.day, option.weekday)}
              </option>
            ))}
          </select>
          <input
            id={`${id}-time`}
            ref={(element) => {
              first.current.time = element;
            }}
            className={cx(day.input, day.mono, shown(problems.time) !== null && day.inputBad)}
            aria-label="Start time"
            inputMode="numeric"
            value={fields.time}
            aria-invalid={shown(problems.time) !== null}
            aria-describedby={`${id}-time-hint ${id}-time-error`}
            onChange={(event) => {
              set({ time: event.target.value });
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <span id={`${id}-time-hint`} className={day.panelHint}>
          {startHint}
        </span>
        <span id={`${id}-time-error`} className={day.fieldError}>
          {shown(problems.time)}
        </span>
      </div>

      <div className={day.field}>
        <label htmlFor={`${id}-duration`} className={day.panelHead}>
          Duration
        </label>
        <input
          id={`${id}-duration`}
          ref={(element) => {
            first.current.duration = element;
          }}
          className={cx(day.input, day.mono, shown(problems.duration) !== null && day.inputBad)}
          value={fields.duration}
          aria-invalid={shown(problems.duration) !== null}
          aria-describedby={`${id}-duration-hint ${id}-duration-error`}
          onChange={(event) => {
            set({ duration: event.target.value });
          }}
          onKeyDown={onKeyDown}
        />
        <span id={`${id}-duration-hint`} className={day.panelHint}>
          From 1m to 24h, like 2h30. Ends {ends}.
        </span>
        <span id={`${id}-duration-error`} className={day.fieldError}>
          {shown(problems.duration)}
        </span>
      </div>

      <TagField
        value={fields.tag}
        tags={tags}
        onEscape={onCancel}
        onChange={(tag) => {
          set({ tag });
        }}
      />

      {refusal !== null && (
        <span role="alert" className={day.refusal}>
          {refusal}
        </span>
      )}
      <div className={day.actions}>
        <button type="submit" className={day.primary} disabled={saving}>
          {isNew ? `save and create tag “${newTag}”` : "save"}
        </button>
        <button type="button" className={day.secondary} onClick={onCancel}>
          cancel
        </button>
      </div>
    </form>
  );
}
