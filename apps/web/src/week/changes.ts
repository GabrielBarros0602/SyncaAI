/**
 * What an edit actually changed.
 *
 * The panel holds four fields and sends a `PATCH`, and the obvious implementation sends all
 * four. That is wrong for a reason worth writing down rather than discovering: `PATCH
 * /tasks/{id}` validates `start_at` against the past whenever the field arrives, so
 * resending an unchanged start time is refused — `A task cannot start in the past` — on any
 * task that has already begun. Correcting a typo in the title of this morning's task would
 * be impossible.
 *
 * Sending only what moved is also what `PATCH` means. The API already distinguishes an
 * absent field from a null one through `model_fields_set`, so absence is a real instruction
 * there and not an accident of serialisation.
 */
import type { Task, TaskChanges } from "../api/types";

/** The four fields the edit panel owns, parsed and validated. */
export interface EditedTask {
  title: string;
  /** ISO instant, already converted from the typed clock time in the user's zone. */
  startAt: string;
  durationMinutes: number;
  /** Null means the task should end up with no tag. */
  tag: string | null;
}

/**
 * One spelling per tag, matching `_normalise_tag` on the server.
 *
 * Only used to compare. The server normalises whatever it is sent, so getting this wrong
 * would cost a redundant write rather than a wrong one — but a redundant write on `tag` is
 * also a redundant `start_at` away from the refusal above, and keeping the two rules in step
 * is cheaper than reasoning about which fields are safe to resend.
 */
function normaliseTag(value: string): string | null {
  const normalised = value.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
  return normalised === "" ? null : normalised;
}

export function changesFrom(task: Task, edited: EditedTask): TaskChanges {
  const changes: TaskChanges = {};

  if (edited.title !== task.title) changes.title = edited.title;

  // Compared as instants rather than as strings. The same moment has several ISO spellings,
  // and a textual comparison would report every save as a change to the start time — which
  // is exactly the field that cannot be resent.
  if (Date.parse(edited.startAt) !== Date.parse(task.start_at)) changes.start_at = edited.startAt;

  if (edited.durationMinutes !== task.duration_minutes) {
    changes.duration_minutes = edited.durationMinutes;
  }

  const tag = edited.tag === null ? null : normaliseTag(edited.tag);
  if (tag !== (task.tag?.name ?? null)) changes.tag = tag;

  return changes;
}

/** Whether an edit asked for anything at all. */
export function isEmpty(changes: TaskChanges): boolean {
  return Object.keys(changes).length === 0;
}
