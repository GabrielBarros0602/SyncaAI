/**
 * Where an open task could go, as the design draws it: the same clock time on another day.
 *
 * Kept apart from the panel that shows it, and handed the task rather than reaching for it,
 * because the offer to move something off a heavy day asks exactly this of exactly this data.
 *
 * Every answer here is advice. The server refuses a start at or before now (ADR-0012) and an
 * overlap through the exclusion constraint (ADR-0008), and this client only sees the week on
 * screen and the evening before it — a day this calls open can still be refused, which is why
 * the panel shows the server's sentence rather than trusting its own.
 */
import type { DayCapacity, Task } from "../api/types";
import { instantAt, zonedDay, zonedMinutes } from "../lib/time";
import { takenBy } from "./occupancy";

/** Why a day is not on offer: the task is already there, the time has gone, or it is taken. */
export type MoveBlocker = "own" | "past" | "taken";

export interface MoveOption {
  day: string;
  weekday: number;
  /** The instant the task would start, already in the user's zone and repaired across DST. */
  startAt: string;
  blocker: MoveBlocker | null;
  /** What is in the way, when the blocker is `taken`. */
  takenBy: Task | null;
}

/**
 * One option per day of the week on screen, in order, each saying whether it is open.
 *
 * `now` is a parameter so the rule can be tested at its boundary. Strictly after it, because
 * that is what the server accepts: a start equal to now is refused as being in the past.
 */
export function moveOptions(
  task: Task,
  days: DayCapacity[],
  tasks: Task[],
  timeZone: string,
  now: Date,
): MoveOption[] {
  const ownDay = zonedDay(task.start_at, timeZone);
  const clockMinutes = zonedMinutes(task.start_at, timeZone);

  return days.map((day) => {
    const start = instantAt(day.day, clockMinutes, timeZone);
    const inTheWay = takenBy(tasks, start, task.duration_minutes, task.id);
    let blocker: MoveBlocker | null = null;
    if (day.day === ownDay) blocker = "own";
    else if (start.getTime() <= now.getTime()) blocker = "past";
    else if (inTheWay !== null) blocker = "taken";

    return {
      day: day.day,
      weekday: day.weekday,
      startAt: start.toISOString(),
      blocker,
      takenBy: blocker === "taken" ? inTheWay : null,
    };
  });
}

/**
 * The open day with the most room, by the server's own figure.
 *
 * Free minutes come from `/capacity`, never from arithmetic here: the budget and the clipping
 * at midnight are the server's (ADR-0022), and a second calculation would be a second answer.
 */
export function lightestOpen(options: MoveOption[], days: DayCapacity[]): DayCapacity | null {
  const open = new Set(options.filter((option) => option.blocker === null).map((option) => option.day));
  const candidates = days.filter((day) => open.has(day.day));
  if (candidates.length === 0) return null;

  return candidates.reduce((best, day) => (day.free_minutes > best.free_minutes ? day : best));
}
