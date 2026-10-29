import { useState } from "react";

import { ApiError } from "../api/client";
import type { DayCapacity, Task, TaskChanges } from "../api/types";
import { clock, formatCompact, weekdayName, zonedMinutes } from "../lib/time";
import { cx } from "../lib/cx";
import { moveTo } from "./changes";
import { lightestOpen, moveOptions, type MoveOption } from "./move";
import day from "./Day.module.css";

interface Props {
  task: Task;
  /** The week on screen, from `/capacity`: which days exist and how much room each has. */
  days: DayCapacity[];
  /** Every task the screen holds, including the evening before the week. */
  tasks: Task[];
  timezone: string;
  onSave: (changes: TaskChanges, sentence?: string) => Promise<void>;
}

function span(task: Task, timezone: string): string {
  const start = zonedMinutes(task.start_at, timezone);
  return `${clock(start)}–${clock(start + task.duration_minutes)}`;
}

/**
 * What stands in the way, in one sentence under the days (item 19 of the round): the days
 * already past as one run, each taken day with the task that holds it, and the lightest.
 */
function whyNot(options: MoveOption[], lightest: DayCapacity | null, timezone: string): string {
  const said: string[] = [];
  const past = options.filter((option) => option.blocker === "past").map((option) => weekdayName(option.weekday));
  if (past.length > 0) {
    said.push(`${past.length > 1 ? `${past[0] ?? ""}–${past[past.length - 1] ?? ""}` : (past[0] ?? "")}: already past.`);
  }
  for (const option of options) {
    if (option.takenBy !== null) {
      said.push(`${weekdayName(option.weekday)}: ${option.takenBy.title} is there, ${span(option.takenBy, timezone)}.`);
    }
  }
  if (lightest !== null) said.push(`${weekdayName(lightest.weekday)} is the lightest.`);
  if (!options.some((option) => option.blocker === null)) said.push("No day this week has that time free.");
  return said.join(" ");
}

/** What a day that cannot take the task says on its button, and to a screen reader. */
function offAs(option: MoveOption): { sub: string; reason: string } {
  if (option.blocker === "own") return { sub: "here", reason: "this day" };
  if (option.blocker === "past") return { sub: "past", reason: "already past" };
  return { sub: "taken", reason: `taken by ${option.takenBy?.title ?? "another task"}` };
}

/**
 * Move to another day of the week, at the same clock time (item 19 of the round).
 *
 * All seven days are shown. The ones that cannot take the task say why on the button, and
 * the sentence below names what is in the way.
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
  // The server's free figure for each day, never arithmetic here (ADR-0022).
  const free = new Map(days.map((capacity) => [capacity.day, capacity.free_minutes]));

  function go(option: MoveOption): void {
    setError(null);
    setSaving(true);
    // Named with its new day and time: the row has left the column it was in, and the day it
    // went to may be scrolled out of view.
    const to = `${weekdayName(option.weekday)} ${String(Number(option.day.slice(8, 10)))}`;
    const at = clock(zonedMinutes(task.start_at, timezone));
    onSave(moveTo(task, option.startAt), `Moved “${task.title}” to ${to}, ${at}.`)
      .catch((problem: unknown) => {
        setError(problem instanceof ApiError ? problem.detail : "Couldn’t reach the server.");
      })
      .finally(() => {
        setSaving(false);
      });
  }

  return (
    <div role="group" aria-label="Move to another day" className={day.panel}>
      <span className={day.panelHead}>Move to</span>
      <span className={day.panelHint}>
        Same clock time, <span className={day.figure}>{span(task, timezone)}</span>, on another day of
        this week.
      </span>
      <div className={day.moveDays}>
        {options.map((option) => {
          const name = weekdayName(option.weekday);
          if (option.blocker !== null) {
            const off = offAs(option);
            return (
              <button
                key={option.day}
                type="button"
                disabled
                className={cx(day.moveDay, day.moveDayOff)}
                aria-label={`${name}: ${off.reason}`}
              >
                <span className={day.moveName}>{name}</span>
                <span className={day.moveSub}>{off.sub}</span>
              </button>
            );
          }
          const room = `${formatCompact(free.get(option.day) ?? 0)} free`;
          const isLightest = lightest?.day === option.day;
          return (
            <button
              key={option.day}
              type="button"
              disabled={saving}
              className={cx(day.moveDay, isLightest && day.moveDayLightest)}
              aria-label={`${name}, ${room}${isLightest ? ", lightest" : ""}`}
              onClick={() => {
                go(option);
              }}
            >
              <span className={day.moveName}>{name}</span>
              <span className={day.moveSub}>{room}</span>
            </button>
          );
        })}
      </div>
      <span className={day.panelHint}>{whyNot(options, lightest, timezone)}</span>
      {error !== null && (
        <span role="alert" className={day.refusal}>
          {error}
        </span>
      )}
    </div>
  );
}
