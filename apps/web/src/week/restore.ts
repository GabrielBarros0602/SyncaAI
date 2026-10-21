/**
 * Whether a deleted task can be put back as it was (ADR-0025).
 *
 * Undo is a recreate — a `POST /tasks` with what the task held — because the API deletes
 * physically (ADR-0011). A create can carry the title, the note, the duration, the tag by name
 * and the checklist labels. It cannot carry a start in the past (ADR-0012), a completion, a
 * ticked item, or the `end_at` that completing early shortened (ADR-0022). So the rule is the
 * three fields of a task's history, and nothing cleverer.
 */
import type { NewTask, Task } from "../api/types";

/** What would make a recreate unfaithful: finished, already begun, or partly ticked. */
export type RestoreBlocker = "done" | "started" | "checked";

/**
 * The first reason this task could not come back as it is, or null when it can.
 *
 * Judged at a moment, so `now` is a parameter. Strictly after now, the same bound the server
 * holds: a start equal to now is refused as being in the past.
 */
export function restoreBlocker(task: Task, now: Date): RestoreBlocker | null {
  if (task.completed_at !== null) return "done";
  if (Date.parse(task.start_at) <= now.getTime()) return "started";
  if (task.items.some((item) => item.completed_at !== null)) return "checked";
  return null;
}

/** Whether recreating this task, at this instant, would bring back the same task. */
export function canBeRestored(task: Task, now: Date): boolean {
  return restoreBlocker(task, now) === null;
}

/**
 * What a recreate sends: exactly what a create can carry, taken before the delete.
 *
 * Optional fields are left out when empty rather than sent as null, because that is what the
 * create schema expects and what the new-task form already does. Checklist labels keep their
 * order; the server assigns positions in the order it receives them.
 */
export function snapshotOf(task: Task): NewTask {
  const items = [...task.items].sort((a, b) => a.position - b.position);
  return {
    title: task.title,
    start_at: task.start_at,
    duration_minutes: task.duration_minutes,
    ...(task.notes === null ? {} : { notes: task.notes }),
    ...(task.tag === null ? {} : { tag: task.tag.name }),
    ...(items.length === 0 ? {} : { items: items.map((item) => ({ label: item.label })) }),
  };
}
