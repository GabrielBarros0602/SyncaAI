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
import { zonedDay, zonedMinutes } from "../lib/time";

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

  // Ending exactly at midnight is not a spill. The range is half-open, and the server's sum
  // clips it the same way — a band reading `0m carried` would be the two disagreeing.
  const minutes = zonedMinutes(task.end_at, timeZone);
  if (minutes === 0) return null;

  return { task, minutes, from };
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
