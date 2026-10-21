import { useState } from "react";

import { ApiError } from "../api/client";
import type { DayCapacity, Task, TaskChanges } from "../api/types";
import { clock, formatCompact, weekdayName, zonedMinutes, zonedStamp } from "../lib/time";
import { cx } from "../lib/cx";
import { moveTo } from "./changes";
import { lightestOpen, moveOptions, type MoveOption } from "./move";
import styles from "./Week.module.css";

interface Props {
  task: Task;
  /** The week on screen, from `/capacity`: which days exist and how much room each has. */
  days: DayCapacity[];
  /** Every task the screen holds, including the evening before the week. */
  tasks: Task[];
  timezone: string;
  onSave: (changes: TaskChanges) => Promise<void>;
}

/** What a disabled day is answering, for somebody who cannot see that it is greyed. */
const BLOCKED: Record<NonNullable<MoveOption["blocker"]>, string> = {
  own: "the day it is on",
  past: "already past",
  taken: "taken",
};

/**
 * Move to another day of the week, at the same clock time.
 *
 * The days this offers are advice and the server decides. A 409 means the constraint found a
 * task this screen cannot see, or one that arrived since it loaded, and the panel stays open
 * with the server's sentence rather than retrying or recalculating — the person can pick
 * another day, and a retry would only be refused the same way.
 */
export function MovePanel({ task, days, tasks, timezone, onSave }: Props): React.ReactNode {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Read at render, not once when the panel opened: the panel can stand open while the clock
  // passes the start it is offering.
  const options = moveOptions(task, days, tasks, timezone, new Date());
  const lightest = lightestOpen(options, days);

  const start = zonedMinutes(task.start_at, timezone);
  const range = `${clock(start)}–${clock(start + task.duration_minutes)}`;
  const anyOpen = options.some((option) => option.blocker === null);

  function go(option: MoveOption): void {
    setError(null);
    setSaving(true);
    onSave(moveTo(task, option.startAt))
      .catch((problem: unknown) => {
        setError(problem instanceof ApiError ? problem.detail : "Couldn’t reach the server.");
      })
      .finally(() => {
        setSaving(false);
      });
  }

  return (
    <div className={styles.panelForm}>
      <div className={styles.panelLabel}>Move to</div>
      <div className={styles.moveDays}>
        {options.map((option) => {
          const name = `${weekdayName(option.weekday)} ${zonedStamp(option.startAt, timezone)}`;
          return (
            <button
              key={option.day}
              type="button"
              className={cx(styles.moveDay, lightest?.day === option.day && styles.moveDayLightest)}
              disabled={option.blocker !== null || saving}
              aria-label={option.blocker === null ? name : `${name}, ${BLOCKED[option.blocker]}`}
              onClick={() => {
                go(option);
              }}
            >
              {weekdayName(option.weekday)}
            </button>
          );
        })}
      </div>
      <p className={styles.panelNote}>
        {anyOpen
          ? `Same clock time on the new day. Days where ${range} is taken, or already past, are out — nothing overlaps.`
          : `No other day this week has ${range} free and still ahead. Edit can change the time instead.`}
        {lightest !== null &&
          ` ${weekdayName(lightest.weekday)} is lightest, ${formatCompact(lightest.free_minutes)} free.`}
      </p>
      {error !== null && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
    </div>
  );
}
