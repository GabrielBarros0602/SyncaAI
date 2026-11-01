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
import { clock, instantAt, zonedDay, zonedMinutes } from "../lib/time";
import { splitOf } from "./carried";
import { takenBy } from "./occupancy";

/** `14:00–15:30`: the clock time a task keeps when it moves. */
export function clockSpan(task: Task, timeZone: string): string {
  const start = zonedMinutes(task.start_at, timeZone);
  return `${clock(start)}–${clock(start + task.duration_minutes)}`;
}

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

/** The one move the heavy-day offer proposes. */
export interface Offer {
  task: Task;
  to: MoveOption;
  /** The receiving day is the lightest after today, not only the lightest with room. */
  lightest: boolean;
  /** What the heavy day would hold once the task has gone. */
  after: number;
}

/**
 * What to move off a day booked past its budget, and where, or null (ADR-0054).
 *
 * The days after today, most free first by the server's figure, and on each the heavy day's
 * own unstarted tasks: the smallest that alone brings the day back within budget, then the
 * largest that does not. The first slot free at the same clock time is the offer.
 */
export function heavyDayOffer(
  capacity: DayCapacity,
  own: Task[],
  days: DayCapacity[],
  tasks: Task[],
  timeZone: string,
  now: Date,
): Offer | null {
  const today = zonedDay(now.toISOString(), timeZone);
  if (!capacity.over_capacity || capacity.day < today) return null;

  const over = capacity.occupied_minutes - capacity.usable_minutes;
  // Stable, so a tie keeps the earlier day first.
  const targets = days
    .filter((day) => day.day > today && day.day !== capacity.day)
    .sort((a, b) => b.free_minutes - a.free_minutes);
  // Only its minutes up to midnight leave this day; the rest were never on it.
  const relief = (task: Task): number => splitOf(task, timeZone)?.own ?? task.duration_minutes;
  const movable = own
    .filter((task) => task.completed_at === null && Date.parse(task.start_at) > now.getTime())
    .sort((a, b) => relief(a) - relief(b));
  const order = [
    ...movable.filter((task) => relief(task) >= over),
    ...movable.filter((task) => relief(task) < over).reverse(),
  ];

  for (const target of targets) {
    for (const task of order) {
      const [to] = moveOptions(task, [target], tasks, timeZone, now);
      if (to?.blocker !== null) continue;
      return { task, to, lightest: target === targets[0], after: capacity.occupied_minutes - relief(task) };
    }
  }
  return null;
}
