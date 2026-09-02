/**
 * What the day before is still holding when this one starts.
 *
 * A task belongs to the day it begins on — it is listed there, counted there, and the five
 * verbs act on it there. But its minutes are counted wherever they fall (ADR-0022), so a
 * Wednesday task running to 04:00 takes four hours off Thursday while owning nothing on it.
 *
 * Before this, Thursday read `1 task · 4h booked` above an empty column. The four hours were
 * true and the row was missing, which is the screen contradicting itself in the one place the
 * whole product is a claim about numbers.
 *
 * Repeating the row on both days was the other option and it is worse: the count would say
 * five tasks where there are three, and a delete button would sit on half a task. The
 * receiving day gets a band instead — the task named, where it came from, and no verbs.
 */
import type { Task } from "../api/types";
import { minutesBetween, startOfLocalDay, zonedDay } from "../lib/time";

export interface Carried {
  task: Task;
  /** How many of this task's minutes land on the receiving day. */
  minutes: number;
  /** The local date the task belongs to, for the way back to the row that owns it. */
  from: string;
}

/**
 * The day a task spills into and by how much, or null when it stays inside its own.
 *
 * Read off `end_at` rather than `duration_minutes`, because `end_at` is what is actually
 * occupied: a task completed early gave its remaining time back, and the band has to agree
 * with the figure in the header that already knows that.
 *
 * One midnight at most, which is not an assumption — the CHECK constraint caps a task at
 * 1440 minutes, so it cannot reach across two.
 */
export function spillOf(task: Task, timeZone: string): Carried | null {
  const from = zonedDay(task.start_at, timeZone);
  const into = zonedDay(task.end_at, timeZone);
  if (into === from) return null;

  // Real time since the receiving day began, not the reading on its clock. The two differ on
  // a daylight saving night, and the difference is a whole hour on the screen: a task running
  // to 04:00 on the day Brazil used to start daylight saving *at* midnight shows four hours
  // on the clock and occupied three, because 00:00 to 01:00 never happened. The band would
  // have claimed 4h under a header the capacity query had already counted as 3h.
  //
  // The server sums against exactly this boundary — `syncaai.time_windows.utc_window` — so
  // measuring it any other way is the client contradicting the figure it sits under.
  const minutes = minutesBetween(startOfLocalDay(into, timeZone), task.end_at);

  // Ending exactly as the day begins is not a spill. The range is half-open and the server
  // clips it the same way, so a band reading `0m carried` would be the two disagreeing about
  // a task neither counts.
  if (minutes === 0) return null;

  return { task, minutes, from };
}

/** How a crossing task's minutes divide between the two days they fall on. */
export interface Split {
  /** Minutes on the day the task starts, and is listed and counted on. */
  own: number;
  /** Minutes on the day after, which gets a band and no row. */
  into: number;
}

/**
 * The two halves of a task that crosses midnight, or null when it does not.
 *
 * Numbers rather than a sentence, so the wording stays where the weekday names are and this
 * stays testable without one.
 *
 * The span is measured between the real ends and not from `duration_minutes`: completing
 * early shortens `end_at` (ADR-0022), and the two halves have to add up to what the day
 * actually holds rather than to what was planned for it.
 *
 * Both halves are real elapsed time, so on a daylight saving night they still add up to the
 * span and neither is the clock's reading of it. The hour that never happened is missing from
 * `own`, which is where it is missing from the day.
 */
export function splitOf(task: Task, timeZone: string): Split | null {
  const carried = spillOf(task, timeZone);
  if (carried === null) return null;

  const occupied = minutesBetween(task.start_at, task.end_at);
  return { own: occupied - carried.minutes, into: carried.minutes };
}

/** Every task's spill, keyed by the day receiving it, in the order they arrive. */
export function carriedInto(tasks: readonly Task[], timeZone: string): Map<string, Carried[]> {
  const byDay = new Map<string, Carried[]>();

  for (const task of tasks) {
    const carried = spillOf(task, timeZone);
    if (carried === null) continue;
    const into = zonedDay(task.end_at, timeZone);
    byDay.set(into, [...(byDay.get(into) ?? []), carried]);
  }

  return byDay;
}
