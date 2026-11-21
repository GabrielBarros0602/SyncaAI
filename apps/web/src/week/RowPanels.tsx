/**
 * What an opened row holds, and what pressing on a row does: the same in the week's grid from
 * 1100px and in the one day's list below it.
 *
 * Out of the row so the two shapes a row takes share one set of verbs, one way of asking
 * before a delete, and one place each panel is opened from. A row decides only how it is drawn
 * and how the keyboard reaches it.
 */
import { useState } from "react";

import { ApiError } from "../api/client";
import { clock, relativeDay, zonedDay, zonedMinutes } from "../lib/time";
import type { DayCapacity, NewTask, Task, TaskChanges } from "../api/types";
import { ChecklistPanel } from "./ChecklistPanel";
import { DeletePanel } from "./DeletePanel";
import { EditPanel } from "./EditPanel";
import { MovePanel } from "./MovePanel";
import { NotePanel } from "./NotePanel";
import { restoreBlocker, restoreBlockers, snapshotOf } from "./restore";
import type { ChecklistChange } from "./useWeek";
import { cx } from "../lib/cx";
import day from "./Day.module.css";

/**
 * What an opened row is showing.
 *
 * `open` is the resting state the disclosure produces: the verbs and the note. The rest are
 * verbs; the checklist is shown by its own, `list`, as the round draws it.
 */
export type Panel = "open" | "edit" | "move" | "note" | "list" | "delete";

export interface Verb {
  panel: Panel;
  label: string;
  /** What the key hint shows. */
  key: string;
  /** How `aria-keyshortcuts` names it. */
  shortcut: string;
  /** The `KeyboardEvent.key` values that reach this verb from the row. */
  keys: string[];
}

const EDIT: Verb = { panel: "edit", label: "edit", key: "E", shortcut: "E", keys: ["e", "E"] };
const MOVE: Verb = { panel: "move", label: "move", key: "M", shortcut: "M", keys: ["m", "M"] };
const NOTE: Verb = { panel: "note", label: "note", key: "O", shortcut: "O", keys: ["o", "O"] };
const LIST: Verb = { panel: "list", label: "checklist", key: "C", shortcut: "C", keys: ["c", "C"] };
// The design's key is ⌫. Delete is accepted beside Backspace because on a Mac keyboard the
// key labelled delete sends Backspace, and on a PC the key labelled Delete sends Delete —
// each person presses the one their keyboard calls delete.
export const DELETE: Verb = {
  panel: "delete",
  label: "delete",
  key: "⌫",
  shortcut: "Delete",
  keys: ["Backspace", "Delete"],
};

/**
 * The verbs a row offers, in the design's order.
 *
 * `move` is withheld from a completed task. Completing early shortens `end_at` to the moment
 * it was done (ADR-0022), so moving a finished task to a day after that moment gives it an
 * empty range: it would appear to move and occupy nothing, and the plan-versus-actual record
 * S6 reads from would stop meaning anything. Whether a finished task should move at all is an
 * open decision in the backlog; until it is made, the verb is not offered.
 */
export function verbsFor(task: Task): Verb[] {
  return task.completed_at === null ? [EDIT, MOVE, NOTE, LIST, DELETE] : [EDIT, NOTE, LIST, DELETE];
}

/**
 * Why the row asks before deleting, one sentence per reason (item 21 of the round): what the
 * undo could not bring back, named in the person's own day and time.
 */
function whyNot(task: Task, timezone: string, now: Date): string[] {
  const today = zonedDay(now.toISOString(), timezone);
  return restoreBlockers(task, now).map((blocker) => {
    if (blocker === "done") return "It is done.";
    if (blocker === "started") {
      const at = clock(zonedMinutes(task.start_at, timezone));
      return `It has started — ${at} ${relativeDay(zonedDay(task.start_at, timezone), today)}.`;
    }
    const ticked = task.items.filter((item) => item.completed_at !== null).length;
    return `${String(ticked)} of ${String(task.items.length)} checklist items ${ticked === 1 ? "is" : "are"} ticked, and would come back unticked.`;
  });
}

export interface RowActions {
  /** The server's sentence for the last thing refused on the closed row, or null. */
  refusal: string | null;
  /** Complete or reopen. A refusal lands in `refusal`. */
  toggle: () => void;
  /** Delete now with an undo when a faithful recreate exists, or ask first when it does not. */
  startDelete: () => void;
  /** A key pressed on the row itself: a verb's letter. True when it was one and was used. */
  verbKey: (event: React.KeyboardEvent) => boolean;
}

/**
 * What pressing on a row does, wherever the row is drawn.
 *
 * A delete or a completion can be pressed with the row shut, so the refusal is the row's to
 * show, and a refusal nobody can see is a refusal that did not happen.
 */
export function useRowActions(
  task: Task,
  onOpen: (panel: Panel | null) => void,
  onToggle: (task: Task) => Promise<void>,
  onDelete: (snapshot: NewTask | null) => Promise<void>,
): RowActions {
  const [refusal, setRefusal] = useState<string | null>(null);

  function refused(problem: unknown): void {
    setRefusal(problem instanceof ApiError ? problem.detail : "Couldn’t reach the server.");
  }

  function toggle(): void {
    setRefusal(null);
    onToggle(task).catch(refused);
  }

  // Judged at the press, not when the row was drawn: a task that could be put back when the
  // screen loaded may have started since (ADR-0025). A faithful recreate exists, so the delete
  // goes now and the undo is offered; otherwise the row asks first and promises nothing.
  function startDelete(): void {
    if (restoreBlocker(task, new Date()) !== null) {
      onOpen("delete");
      return;
    }
    setRefusal(null);
    onDelete(snapshotOf(task)).catch(refused);
  }

  function verbKey(event: React.KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const verb = verbsFor(task).find((candidate) => candidate.keys.includes(event.key));
    if (verb === undefined) return false;
    event.preventDefault();
    if (verb === DELETE) startDelete();
    else onOpen(verb.panel);
    return true;
  }

  return { refusal, toggle, startDelete, verbKey };
}

interface Props {
  task: Task;
  /** Which panel is showing. The row is open, or this is not drawn. */
  open: Panel;
  timezone: string;
  /** The week on screen and every task it holds, which is what the move panel weighs. */
  days: DayCapacity[];
  allTasks: Task[];
  /** A write about this task has not reached the screen yet. */
  saving: boolean;
  actions: RowActions;
  onOpen: (panel: Panel | null) => void;
  onSave: (changes: TaskChanges, sentence?: string) => Promise<void>;
  onDelete: (snapshot: NewTask | null) => Promise<void>;
  onChecklist: (change: ChecklistChange) => Promise<void>;
  /**
   * The one day's list below 1100px, which opens a row as day-phone.dc.html does: the
   * checklist is on the opened row itself, with room for it, rather than behind its own verb;
   * the verbs come after what they act on; and the row's own button closes it, so there is no
   * "esc" to press.
   */
  list?: boolean;
}

/** The verbs of an opened row, and the panel the one that is pressed opens. */
export function RowPanels({
  task,
  open,
  timezone,
  days,
  allTasks,
  saving,
  actions,
  onOpen,
  onSave,
  onDelete,
  onChecklist,
  list = false,
}: Props): React.ReactNode {
  const done = task.completed_at !== null;
  // Below 1100px a list with items is already on the opened row, so the verb is offered only
  // to start one, as the drawing's "Add checklist" is.
  const verbs = verbsFor(task).filter((verb) => !(list && verb === LIST && task.items.length > 0));
  const listOnRow = list && (open === "list" || (open === "open" && task.items.length > 0));

  const toolbar = (
    <div
      role="toolbar"
      aria-label={`Actions for ${task.title}`}
      className={cx(day.verbs, list && day.verbsList)}
    >
      {verbs.map((verb) => (
        <button
          key={verb.panel}
          type="button"
          className={cx(day.verb, open === verb.panel && day.verbOn)}
          aria-pressed={open === verb.panel}
          aria-keyshortcuts={verb.shortcut}
          onClick={() => {
            if (open === verb.panel) onOpen("open");
            else if (verb === DELETE) actions.startDelete();
            else onOpen(verb.panel);
          }}
        >
          {verb.label}
          <kbd aria-hidden="true" className={day.cap}>
            {verb.key}
          </kbd>
        </button>
      ))}
      {!list && (
        <button
          type="button"
          className={day.close}
          aria-label="Close"
          aria-keyshortcuts="Escape"
          onClick={() => {
            onOpen(null);
          }}
        >
          esc
        </button>
      )}
    </div>
  );

  const panel = (
    <>
      {open === "edit" && (
        <EditPanel
          task={task}
          days={days}
          timezone={timezone}
          onSave={onSave}
          onCancel={() => {
            onOpen("open");
          }}
        />
      )}

      {open === "delete" && (
        <DeletePanel
          reasons={whyNot(task, timezone, new Date())}
          onConfirm={() => onDelete(null)}
          onCancel={() => {
            onOpen("open");
          }}
        />
      )}

      {open === "move" && !done && (
        <MovePanel task={task} days={days} tasks={allTasks} timezone={timezone} list={list} onSave={onSave} />
      )}

      {open === "note" && (
        <NotePanel
          task={task}
          onSave={onSave}
          onCancel={() => {
            onOpen("open");
          }}
        />
      )}

      {(listOnRow || (!list && open === "list")) && (
        <ChecklistPanel
          task={task}
          saving={saving}
          list={list}
          onChange={onChecklist}
          onCancel={() => {
            onOpen("open");
          }}
        />
      )}
    </>
  );

  return list ? (
    <>
      {panel}
      {toolbar}
    </>
  ) : (
    <>
      {toolbar}
      {panel}
    </>
  );
}
